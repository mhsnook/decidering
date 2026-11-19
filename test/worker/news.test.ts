import { env } from 'cloudflare:workers'
import { getServerByName } from 'partyserver'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '../../worker/leads.ts'
import { searchNews } from '../../worker/news.ts'
import type { Tracker } from '../../worker/tracker.ts'
import { rows, seed } from './helpers.ts'

const NOW = new Date('2026-11-19T12:00:00Z')

// Every query gets the same results, so the second query onward also shows that a
// hit already queued is not queued again.
const HITS: SearchHit[] = [
  { url: 'https://news.example/ann', title: 'Ann Alpha backs the plan', description: 'Rep. Alpha said on Monday she would vote for it.', lastModifiedDate: '2026-11-18T09:00:00Z' },
  { url: 'https://news.example/bob', title: 'Senator speaks', description: 'Bob Beta, who sits in the Senate, came out against it.' },
  { url: 'https://news.example/both', title: 'Ann Alpha and Bob Beta trade words', description: 'The two disagreed on the floor.' },
  { url: 'https://news.example/cara', title: 'Cara Gamma weighs in', description: 'Cara Gamma sits on a demo council only.' },
  { url: 'https://news.example/dan', title: 'Dan Delta weighs in', description: 'Dan Delta holds no seat.' },
  { url: 'https://news.example/nobody', title: 'The plan, explained', description: 'A long explainer naming nobody on the roster.' },
]

function stubbedEnv(respond: (query: string) => Response | Promise<Response> = () => Response.json({ items: HITS })) {
  const websearch = vi.fn(async ({ query }: { query: string }) => respond(query))
  return { env: { ...env, AI: { websearch } } as unknown as Env, websearch }
}

const tracker = () => getServerByName<Env, Tracker>(env.Tracker, 'main')

const leads = () =>
  rows<{ url: string; question_id: string; decider_id: string; origin: string; reading: null; occurred_on: string | null }>(
    `SELECT s.url, i.question_id, i.decider_id, p.origin, i.reading, i.occurred_on
     FROM proposal_items i JOIN proposals p ON p.id = i.proposal_id JOIN sources s ON s.id = p.source_id
     ORDER BY s.url, i.question_id, i.decider_id`,
  )

beforeAll(seed)

// Every article refuses the fetch, so each hit falls back to a lead built from
// the search excerpt. Reading articles is tested in reading.test.ts.
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('no', { status: 403 }))
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('searchNews', () => {
  it('searches only open, in-the-news, non-demo questions and queues hits naming the roster', async () => {
    const { env, websearch } = stubbedEnv()
    const report = await searchNews(env, await tracker(), NOW)

    const queries = websearch.mock.calls.map(([args]) => args.query)
    // A question closed in the past and the demo body's question are not searched;
    // one whose closing date lies ahead still is.
    expect(queries.filter((q) => q.includes('"Hot Topic" Congress'))).toHaveLength(4)
    expect(queries.filter((q) => q.includes('"Closing Topic" Congress'))).toHaveLength(4)
    expect(queries).toHaveLength(8)
    expect(queries[0]).toBe('"Hot Topic" Congress statement November 2026')
    expect(websearch.mock.calls[0][0]).toMatchObject({ gatewayId: 'sporelight', provider: 'exa', limit: 10 })

    // The hot question is put to the Senate as well, so Bob is on its roster. The
    // closing question is put to Congress alone, so only Ann is.
    expect(await leads()).toEqual([
      { url: 'https://news.example/ann', question_id: 'closing', decider_id: 'ann', origin: 'news_search', reading: null, occurred_on: '2026-11-18' },
      { url: 'https://news.example/ann', question_id: 'hot', decider_id: 'ann', origin: 'news_search', reading: null, occurred_on: '2026-11-18' },
      { url: 'https://news.example/bob', question_id: 'hot', decider_id: 'bob', origin: 'news_search', reading: null, occurred_on: null },
      { url: 'https://news.example/both', question_id: 'closing', decider_id: 'ann', origin: 'news_search', reading: null, occurred_on: null },
      { url: 'https://news.example/both', question_id: 'hot', decider_id: 'ann', origin: 'news_search', reading: null, occurred_on: null },
      { url: 'https://news.example/both', question_id: 'hot', decider_id: 'bob', origin: 'news_search', reading: null, occurred_on: null },
    ])
    expect(report).toEqual({
      questions: [
        { question: 'Hot Topic', hits: 24, read: 3, queued: 4 },
        { question: 'Closing Topic', hits: 24, read: 2, queued: 2 },
      ],
      deferred: 0,
    })
  })

  it('puts the search excerpt and the query in an editor-only note', async () => {
    const notes = await rows<{ body: string; url: string }>(
      `SELECT n.body, s.url FROM proposal_notes n JOIN proposals p ON p.id = n.proposal_id JOIN sources s ON s.id = p.source_id WHERE s.url = 'https://news.example/ann' ORDER BY n.body`,
    )
    expect(notes.map((n) => n.body)).toEqual([
      'Search excerpt, not a verified quote. Found by searching: "Closing Topic" Congress statement November 2026\nThe article was not read: The site answered 403.',
      'Search excerpt, not a verified quote. Found by searching: "Hot Topic" Congress statement November 2026\nThe article was not read: The site answered 403.',
    ])
  })

  it('queues nothing new on a second run over the same results', async () => {
    const before = await leads()
    const report = await searchNews(stubbedEnv().env, await tracker(), NOW)
    expect(report.questions.map((q) => q.queued)).toEqual([0, 0])
    expect(await leads()).toEqual(before)
  })

  it('stops and reports a failed search', async () => {
    const { env, websearch } = stubbedEnv(() => new Response('gateway says no', { status: 502 }))
    const report = await searchNews(env, await tracker(), NOW)
    expect(websearch).toHaveBeenCalledTimes(1)
    expect(report).toEqual({ error: 'Web search failed (502: gateway says no)', questions: [{ question: 'Hot Topic', hits: 0, read: 0, queued: 0 }], deferred: 0 })
  })

  it('stops and reports a search that throws', async () => {
    const { env } = stubbedEnv(() => Promise.reject(new Error('network down')))
    const report = await searchNews(env, await tracker(), NOW)
    expect(report.error).toBe('Web search failed (Error: network down)')
  })
})
