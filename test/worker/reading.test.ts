import { env } from 'cloudflare:workers'
import { getServerByName } from 'partyserver'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '../../worker/leads.ts'
import { dryRunArticle, MAX_READS_PER_RUN, searchNews } from '../../worker/news.ts'
import { MODEL } from '../../worker/reader.ts'
import type { Tracker } from '../../worker/tracker.ts'
import { rows, seed } from './helpers.ts'

const NOW = new Date('2026-11-19T12:00:00Z')

// Under the hot question: a measure put to everyone, an ask put to Bob by name,
// and an ask put to whoever chairs the committee, which Ann does now and Bob
// did before her.
beforeAll(async () => {
  await seed()
  await env.DB.batch(
    [
      `INSERT INTO questions (id, slug, body_id, parent_id, kind, title, short_title, is_hot, status) VALUES
        ('hot-bill', 'hot-bill', 'congress', 'hot', 'formal_act', 'Have they cosponsored the bill?', 'Bill', 0, 'open'),
        ('hot-ask-bob', 'hot-ask-bob', 'congress', 'hot', 'position', 'Will Bob hold a hearing?', 'Hearing', 0, 'open'),
        ('hot-ask-chair', 'hot-ask-chair', 'congress', 'hot', 'position', 'Will the chair schedule a markup?', 'Markup', 0, 'open'),
        ('hot-old', 'hot-old', 'congress', 'hot', 'formal_act', 'Did they sign the old letter?', 'Old letter', 0, 'lapsed')`,
      `INSERT INTO question_deciders (id, question_id, decider_id) VALUES ('qd-bob', 'hot-ask-bob', 'bob')`,
      `INSERT INTO offices (id, body_id, label) VALUES ('chair', 'congress', 'Committee chair')`,
      `INSERT INTO office_holders (id, office_id, decider_id, starts_on, ends_on) VALUES
        ('h-bob', 'chair', 'bob', '2020-01-01', '2025-01-03'), ('h-ann', 'chair', 'ann', '2025-01-03', NULL)`,
      `INSERT INTO question_offices (id, question_id, office_id) VALUES ('qo-chair', 'hot-ask-chair', 'chair')`,
    ].map((sql) => env.DB.prepare(sql)),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

const FILLER = ' The committee met for several hours and heard from witnesses on both sides of the debate.'.repeat(4)
const page = (body: string) => `<html><head><title>T</title></head><body><article><p>${body}</p><p>${FILLER}</p></article></body></html>`

type Act = Record<string, unknown>
const act = (overrides: Act = {}): Act => ({
  person_id: 'ann',
  question_id: 'hot',
  kind: 'says',
  quote: 'I will vote for this bill when it reaches the floor',
  occurred_on: '2026-11-16',
  position: 'support',
  bearing: 'direct',
  summary: 'Says she will vote for it.',
  reason: 'A direct statement of how she will vote.',
  ...overrides,
})

// A run of the news search in which the search returns `hits` for the hot
// question only, every page in `pages` can be fetched, and the model answers
// `answer(url)`.
function stubbed({ hits, pages, answer }: { hits: SearchHit[]; pages: Record<string, string | number>; answer: (prompt: string) => unknown }) {
  const websearch = vi.fn(async ({ query }: { query: string }) => Response.json({ items: query.includes('"Hot Topic"') ? hits : [] }))
  const toMarkdown = vi.fn(async (doc: { blob: Blob }) => ({ format: 'text', data: (await doc.blob.text()).replace(/<[^>]+>/g, ' ') }))
  const run = vi.fn(async (_model: string, inputs: { messages: { content: string }[] }) => {
    const reply = answer(inputs.messages[1].content)
    if (reply instanceof Error) throw reply
    return { choices: [{ message: { role: 'assistant', content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }
  })
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    const found = pages[url]
    if (found === undefined) throw new Error(`unexpected fetch of ${url}`)
    return typeof found === 'number' ? new Response('no', { status: found }) : new Response(found, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
  return { env: { ...env, AI: { websearch, toMarkdown, run } } as unknown as Env, websearch, toMarkdown, run, fetcher }
}

const hit = (url: string, title = 'Ann Alpha on the plan'): SearchHit => ({ url, title, description: 'Rep. Alpha spoke about the plan this week.', lastModifiedDate: '2026-11-17T09:00:00Z' })

const tracker = () => getServerByName<Env, Tracker>(env.Tracker, 'main')

const proposalsFor = (url: string) =>
  rows<{ id: string; origin: string }>(`SELECT p.id, p.origin FROM proposals p JOIN sources s ON s.id = p.source_id WHERE s.url = ?`, url)
const itemsFor = (url: string) =>
  rows(
    `SELECT i.decider_id, i.question_id, i.kind, i.occurred_on, i.quote, i.reading, i.bearing, i.position, i.summary
     FROM proposal_items i JOIN proposals p ON p.id = i.proposal_id JOIN sources s ON s.id = p.source_id WHERE s.url = ? ORDER BY i.sort`,
    url,
  )
const notesFor = (url: string) =>
  rows<{ body: string; on_item: number }>(
    `SELECT n.body, n.proposal_item_id IS NOT NULL AS on_item FROM proposal_notes n JOIN proposals p ON p.id = n.proposal_id JOIN sources s ON s.id = p.source_id WHERE s.url = ? ORDER BY on_item, n.body`,
    url,
  )
const readsOf = (url: string) => rows<{ question_id: string; outcome: string; model: string | null; detail: string | null }>(`SELECT question_id, outcome, model, detail FROM article_reads WHERE url = ?`, url)

describe('reading articles', () => {
  it('queues one proposal per article with an item per act whose words are in the article', async () => {
    const url = 'https://news.example/read-1'
    const s = stubbed({
      hits: [hit(url, 'Ann Alpha and Bob Beta on the plan')],
      pages: { [url]: page('Ann Alpha said: “I will vote for this bill when it reaches the floor.” Bob Beta voted against the rule on Tuesday.') },
      answer: () => ({
        acts: [act(), act({ person_id: 'bob', kind: 'does', quote: 'Bob Beta voted against the rule on Tuesday', occurred_on: '2026-11-18', position: 'lean_oppose', bearing: 'indirect', summary: 'Voted against the rule.', reason: 'The rule governs debate on the bill.' })],
      }),
    })
    const report = await searchNews(s.env, await tracker(), NOW)

    expect(report.questions[0]).toEqual({ question: 'Hot Topic', hits: 4, read: 1, queued: 2 })
    expect(s.fetcher).toHaveBeenCalledTimes(1)
    expect(s.run).toHaveBeenCalledTimes(1)
    expect(await proposalsFor(url)).toEqual([expect.objectContaining({ origin: 'model' })])
    expect(await itemsFor(url)).toEqual([
      { decider_id: 'ann', question_id: 'hot', kind: 'says', occurred_on: '2026-11-16', quote: 'I will vote for this bill when it reaches the floor', reading: 'support', bearing: 'direct', position: null, summary: 'Says she will vote for it.' },
      { decider_id: 'bob', question_id: 'hot', kind: 'does', occurred_on: '2026-11-18', quote: 'Bob Beta voted against the rule on Tuesday', reading: 'lean_oppose', bearing: 'indirect', position: null, summary: 'Voted against the rule.' },
    ])
    const notes = await notesFor(url)
    expect(notes[0]).toMatchObject({ on_item: 0 })
    expect(notes[0].body).toContain(MODEL)
    expect(notes.slice(1).map((n) => n.body)).toEqual(["Model's reason: A direct statement of how she will vote.", "Model's reason: The rule governs debate on the bill."])
    expect(await readsOf(url)).toEqual([{ question_id: 'hot', outcome: 'queued', model: MODEL, detail: null }])
  })

  it('keeps the model reason out of every public column', async () => {
    const leaked = await rows(
      `SELECT 1 FROM proposal_items WHERE quote LIKE '%reason%' OR summary LIKE '%Model%' UNION ALL SELECT 1 FROM sources WHERE title LIKE '%Model%' OR url LIKE '%reason%'`,
    )
    expect(leaked).toEqual([])
  })

  it('routes the search and the model through the app gateway', async () => {
    const url = 'https://news.example/read-gateway'
    const s = stubbed({ hits: [hit(url)], pages: { [url]: page('Nothing much.') }, answer: () => ({ acts: [] }) })
    await searchNews(s.env, await tracker(), NOW)
    expect(s.websearch.mock.calls[0][0]).toMatchObject({ gatewayId: 'sporelight', provider: 'exa' })
    expect(s.run.mock.calls[0][0]).toBe(MODEL)
    expect((s.run.mock.calls[0] as unknown[])[2]).toEqual({ gateway: { id: 'sporelight' } })
  })

  it('tells the model the question, its open sub-questions, and which of them are put to each person', async () => {
    const url = 'https://news.example/read-context'
    const s = stubbed({ hits: [hit(url, 'Ann Alpha and Bob Beta on the plan')], pages: { [url]: page('Words.') }, answer: () => ({ acts: [] }) })
    await searchNews(s.env, await tracker(), NOW)
    const prompt = (s.run.mock.calls[0][1] as { messages: { content: string }[] }).messages[1].content
    const people = JSON.parse(prompt.split('People, with the questions each can be read on:\n')[1].split('\n\nArticle:')[0])
    // Ann chairs the committee today, so the markup ask is put to her and not
    // to Bob, who chaired it before. The lapsed letter is offered to no one.
    expect(people).toEqual([
      { person_id: 'ann', name: 'Ann Alpha', question_ids: ['hot', 'hot-bill', 'hot-ask-chair'] },
      { person_id: 'bob', name: 'Bob Beta', question_ids: ['hot', 'hot-bill', 'hot-ask-bob'] },
    ])
    expect(prompt).not.toContain('hot-old')
  })

  it('drops an act whose quote is not in the article, and queues nothing when none is left', async () => {
    const url = 'https://news.example/read-paraphrase'
    const s = stubbed({
      hits: [hit(url)],
      pages: { [url]: page('Ann Alpha said she would probably back the bill.') },
      answer: () => ({ acts: [act({ quote: 'I will back this bill' })] }),
    })
    const report = await searchNews(s.env, await tracker(), NOW)
    expect(report.questions[0]).toMatchObject({ read: 1, queued: 0 })
    expect(await proposalsFor(url)).toEqual([])
    expect(await readsOf(url)).toEqual([{ question_id: 'hot', outcome: 'no_acts', model: MODEL, detail: 'ann on hot: "I will back this bill" quotes words that are not in the article' }])
  })

  it('drops an act by someone the article was not read for, or on a question not put to them', async () => {
    const url = 'https://news.example/read-wrong-people'
    const text = 'Ann Alpha said: “I will vote for this bill when it reaches the floor.” Cara Gamma agreed with every word of it.'
    const s = stubbed({
      hits: [hit(url)],
      pages: { [url]: page(text) },
      answer: () => ({
        acts: [act({ question_id: 'hot-ask-bob' }), act({ person_id: 'cara', quote: 'Cara Gamma agreed with every word of it' }), act({ question_id: 'hot-bill', kind: 'commits' })],
      }),
    })
    await searchNews(s.env, await tracker(), NOW)
    expect((await itemsFor(url)).map((i) => i.question_id)).toEqual(['hot-bill'])
    expect((await notesFor(url))[0].body).toContain('2 more acts were left out')
  })

  it('queues nothing when the model finds no act', async () => {
    const url = 'https://news.example/read-nothing'
    const s = stubbed({ hits: [hit(url)], pages: { [url]: page('Ann Alpha was seen at the ribbon cutting.') }, answer: () => ({ acts: [] }) })
    await searchNews(s.env, await tracker(), NOW)
    expect(await proposalsFor(url)).toEqual([])
    expect(await readsOf(url)).toEqual([{ question_id: 'hot', outcome: 'no_acts', model: MODEL, detail: null }])
  })

  it.each([
    ['the site refuses the fetch', 403, () => ({ acts: [] }), 'The site answered 403.'],
    ['the page has almost no text', '<html><body>Subscribe</body></html>', () => ({ acts: [] }), 'The page has almost no text'],
    ['the model call fails', page('Words.'), () => new Error('3040: capacity'), 'The model call failed (Error: 3040: capacity).'],
    ['the model answers with something that is not JSON', page('Words.'), () => 'Sure! Here are the acts:', "The model's answer did not fit the expected shape"],
    ['the model answers in the wrong shape', page('Words.'), () => ({ statements: [] }), "The model's answer did not fit the expected shape"],
  ])('falls back to the search excerpt when %s', async (name, body, answer, reason) => {
    const url = `https://news.example/read-fallback-${name.replaceAll(' ', '-')}`
    const s = stubbed({ hits: [hit(url)], pages: { [url]: body }, answer })
    await searchNews(s.env, await tracker(), NOW)
    expect(await proposalsFor(url)).toEqual([expect.objectContaining({ origin: 'news_search' })])
    expect(await itemsFor(url)).toEqual([expect.objectContaining({ decider_id: 'ann', reading: null, quote: 'Rep. Alpha spoke about the plan this week.' })])
    expect((await notesFor(url))[0].body).toContain(`The article was not read: ${reason}`)
    expect(await readsOf(url)).toEqual([expect.objectContaining({ outcome: 'not_read', model: null })])
  })

  it('does not fetch or read the same article for the same question again', async () => {
    const url = 'https://news.example/read-1'
    const s = stubbed({ hits: [hit(url)], pages: {}, answer: () => ({ acts: [] }) })
    const report = await searchNews(s.env, await tracker(), NOW)
    expect(s.fetcher).not.toHaveBeenCalled()
    expect(s.run).not.toHaveBeenCalled()
    expect(report.questions[0]).toMatchObject({ read: 0, queued: 0 })
  })

  it('does not read an article already proposed from on the question before the read log existed', async () => {
    const url = 'https://news.example/read-old-lead'
    await (await tracker()).propose({ source: { url, title: null }, note: null, items: [{ question_id: 'hot', decider_id: 'ann', kind: 'says', occurred_on: null, quote: 'An old search excerpt.', reading: null }] }, 'news_search')
    const s = stubbed({ hits: [hit(url)], pages: {}, answer: () => ({ acts: [] }) })
    await searchNews(s.env, await tracker(), NOW)
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('reads at most MAX_READS_PER_RUN articles in a run and leaves the rest for the next', async () => {
    const urls = Array.from({ length: MAX_READS_PER_RUN + 3 }, (_, i) => `https://news.example/cap-${i}`)
    const pages = Object.fromEntries(urls.map((u) => [u, page('Nothing of note.')]))
    const first = stubbed({ hits: urls.map((u) => hit(u)), pages, answer: () => ({ acts: [] }) })
    const report = await searchNews(first.env, await tracker(), NOW)
    expect(first.fetcher).toHaveBeenCalledTimes(MAX_READS_PER_RUN)
    expect(report.questions[0].read).toBe(MAX_READS_PER_RUN)
    // Every query returns the same hits, so the three left over are counted once per query.
    expect(report.deferred).toBe(3 * 4)
    vi.restoreAllMocks()

    const second = stubbed({ hits: urls.map((u) => hit(u)), pages, answer: () => ({ acts: [] }) })
    await searchNews(second.env, await tracker(), NOW)
    expect(second.fetcher.mock.calls.map(([u]) => String(u))).toEqual(urls.slice(MAX_READS_PER_RUN))
  })
})

describe('dryRunArticle', () => {
  it('returns what would be queued and writes nothing', async () => {
    const url = 'https://news.example/dry-run'
    const s = stubbed({
      hits: [],
      pages: { [url]: page('Ann Alpha said: “I will vote for this bill when it reaches the floor.” Dan Delta was there too.') },
      answer: () => ({ acts: [act()] }),
    })
    const count = () => rows(`SELECT (SELECT COUNT(*) FROM proposals) AS p, (SELECT COUNT(*) FROM article_reads) AS r`)
    const before = await count()
    const result = await dryRunArticle(s.env, url, 'hot', NOW)
    expect(result).toMatchObject({ outcome: 'acts', model: MODEL, people: ['Ann Alpha'] })
    expect('draft' in result && result.draft.items).toEqual([expect.objectContaining({ decider_id: 'ann', quote: 'I will vote for this bill when it reaches the floor' })])
    expect(await count()).toEqual(before)
  })

  it('says so when the article names nobody on the roster', async () => {
    const url = 'https://news.example/dry-run-nobody'
    const s = stubbed({ hits: [], pages: { [url]: page('Dan Delta was there.') }, answer: () => ({ acts: [] }) })
    expect(await dryRunArticle(s.env, url, 'hot', NOW)).toMatchObject({ outcome: 'no_people' })
    expect(s.run).not.toHaveBeenCalled()
  })
})
