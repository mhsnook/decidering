import { createScheduledController } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getServerByName } from 'partyserver'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchArticle, MAX_BYTES } from '../../worker/article.ts'
import worker from '../../worker/index.ts'
import type { SearchHit } from '../../worker/leads.ts'
import { dryRunArticle, MAX_READS_PER_RUN, queueIsAttended, searchNews } from '../../worker/news.ts'
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

    expect(report.questions[0]).toMatchObject({ question: 'Hot Topic', read: 1, queued: 2 })
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
    const reasons = ['A direct statement of how she will vote.', 'The rule governs debate on the bill.']
    for (const reason of reasons) {
      const like = `%${reason}%`
      expect(
        await rows(
          `SELECT 1 FROM proposal_items WHERE quote LIKE ?1 OR summary LIKE ?1
           UNION ALL SELECT 1 FROM proposals WHERE submitted_by LIKE ?1
           UNION ALL SELECT 1 FROM sources WHERE title LIKE ?1 OR url LIKE ?1`,
          like,
        ),
      ).toEqual([])
      expect(await rows(`SELECT 1 FROM proposal_notes WHERE body LIKE ?`, like)).toHaveLength(1)
    }
  })

  it('routes the search and the model through the app gateway', async () => {
    const url = 'https://news.example/read-gateway'
    const s = stubbed({ hits: [hit(url)], pages: { [url]: page('Nothing much.') }, answer: () => ({ acts: [] }) })
    await searchNews(s.env, await tracker(), NOW)
    // Both have to go through the gateway that carries the spending limit.
    expect(s.websearch.mock.calls[0][0]).toMatchObject({ gatewayId: env.AI_GATEWAY })
    expect((s.run.mock.calls[0] as unknown[])[2]).toEqual({ gateway: { id: env.AI_GATEWAY } })
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
    const url = 'https://news.example/read-twice'
    const first = stubbed({ hits: [hit(url)], pages: { [url]: page('Nothing of note.') }, answer: () => ({ acts: [] }) })
    await searchNews(first.env, await tracker(), NOW)
    expect(first.fetcher).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()

    const second = stubbed({ hits: [hit(url)], pages: {}, answer: () => ({ acts: [] }) })
    const report = await searchNews(second.env, await tracker(), NOW)
    expect(second.fetcher).not.toHaveBeenCalled()
    expect(second.run).not.toHaveBeenCalled()
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

describe('when a model call fails', () => {
  it('falls back for that article and leaves the rest of the run for the next one', async () => {
    const urls = ['https://news.example/down-0', 'https://news.example/down-1', 'https://news.example/down-2']
    const pages = Object.fromEntries(urls.map((u) => [u, page('Nothing of note.')]))
    const first = stubbed({ hits: urls.map((u) => hit(u)), pages, answer: () => new Error('2016: spending limit reached') })
    const report = await searchNews(first.env, await tracker(), NOW)
    expect(first.run).toHaveBeenCalledTimes(1)
    expect(report.error).toBe('Stopped reading articles: The model call failed (Error: 2016: spending limit reached).')
    expect(await proposalsFor(urls[0])).toEqual([expect.objectContaining({ origin: 'news_search' })])
    expect(await readsOf(urls[1])).toEqual([])
    vi.restoreAllMocks()

    const second = stubbed({ hits: urls.map((u) => hit(u)), pages, answer: () => ({ acts: [] }) })
    await searchNews(second.env, await tracker(), NOW)
    expect(second.fetcher.mock.calls.map(([u]) => String(u))).toEqual(urls.slice(1))
  })
})

const resetQueue = () => env.DB.prepare(`UPDATE proposals SET status = 'reviewed', reviewed_at = '2026-01-01T00:00:00Z'`).run()

describe('queueIsAttended', () => {
  const at = (iso: string) => new Date(iso)
  // Each case starts from a queue with nothing pending and nothing reviewed
  // lately, then adds what it needs.
  const clearQueue = resetQueue
  const pending = async (origin: string) => {
    const id = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sources (id, url, created_at) VALUES (?, ?, '2026-11-18T00:00:00Z')`).bind(id, `https://news.example/queue-${id}`),
      env.DB.prepare(`INSERT INTO proposals (id, source_id, origin, status, created_at) VALUES (?, ?, ?, 'pending', '2026-11-18T00:00:00Z')`).bind(id, id, origin),
    ])
    return id
  }
  const review = (id: string, when: string) => env.DB.prepare(`UPDATE proposals SET status = 'reviewed', reviewed_at = ? WHERE id = ?`).bind(when, id).run()

  it('goes ahead when nothing automated is waiting', async () => {
    await clearQueue()
    expect(await queueIsAttended(env.DB, NOW)).toBe(true)
  })

  it('is not held up by proposals readers leave waiting', async () => {
    await clearQueue()
    await pending('reader')
    await pending('reader')
    expect(await queueIsAttended(env.DB, NOW)).toBe(true)
  })

  it('holds back while automated leads wait and none was reviewed in the last day', async () => {
    await clearQueue()
    await pending('news_search')
    await pending('model')
    expect(await queueIsAttended(env.DB, NOW)).toBe(false)
  })

  it('goes ahead for a day after an editor reviews an automated lead', async () => {
    await clearQueue()
    await pending('model')
    await review(await pending('news_search'), '2026-11-19T02:00:00Z')
    expect(await queueIsAttended(env.DB, at('2026-11-19T12:00:00Z'))).toBe(true)
    expect(await queueIsAttended(env.DB, at('2026-11-20T12:00:00Z'))).toBe(false)
  })

  it('does not count a review of a reader proposal as attending to the news leads', async () => {
    await clearQueue()
    await pending('model')
    await review(await pending('reader'), '2026-11-19T02:00:00Z')
    expect(await queueIsAttended(env.DB, NOW)).toBe(false)
  })
})

describe('the scheduled run', () => {
  const fire = () => worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: '17 14 * * *' }), env)

  it('does not search while the queue is unattended', async () => {
    await resetQueue()
    await (await tracker()).propose({ source: { url: 'https://news.example/scheduled-waiting', title: null }, note: null, items: [{ question_id: 'hot', decider_id: 'ann', kind: 'says', occurred_on: null, quote: 'A lead nobody has looked at.', reading: null }] }, 'news_search')
    const websearch = vi.spyOn(env.AI, 'websearch')
    await fire()
    expect(websearch).not.toHaveBeenCalled()
  })

  it('searches once the queue is attended', async () => {
    await env.DB.prepare(`UPDATE proposals SET status = 'reviewed', reviewed_at = '2026-11-19T02:00:00Z' WHERE status = 'pending'`).run()
    const websearch = vi.spyOn(env.AI, 'websearch').mockImplementation(async () => Response.json({ items: [] }))
    await fire()
    expect(websearch).toHaveBeenCalled()
  })
})

describe('fetchArticle', () => {
  const ai = () => ({ toMarkdown: vi.fn(async (doc: { blob: Blob }) => ({ format: 'text', data: await doc.blob.text() })) })
  const serve = (response: () => Response) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response())
  const body = (bytes: number) => 'a'.repeat(bytes)

  it('refuses a page whose declared size is over the limit, without reading it', async () => {
    serve(() => new Response(body(10), { headers: { 'content-type': 'text/html', 'content-length': String(MAX_BYTES + 1) } }))
    const AI = ai()
    expect(await fetchArticle({ AI } as unknown as Env, 'https://news.example/huge')).toEqual({ ok: false, reason: 'The page is too large to read.' })
    expect(AI.toMarkdown).not.toHaveBeenCalled()
  })

  it('stops reading a page with no declared size once it passes the limit', async () => {
    const chunk = new TextEncoder().encode(body(1_000_000))
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++
        controller.enqueue(chunk)
      },
    })
    serve(() => new Response(stream, { headers: { 'content-type': 'text/html' } }))
    const AI = ai()
    expect(await fetchArticle({ AI } as unknown as Env, 'https://news.example/endless')).toEqual({ ok: false, reason: 'The page is too large to read.' })
    expect(sent).toBeLessThan(10)
    expect(AI.toMarkdown).not.toHaveBeenCalled()
  })

  it('refuses something that is not an article without converting it', async () => {
    serve(() => new Response(body(5000), { headers: { 'content-type': 'image/png' } }))
    const AI = ai()
    expect(await fetchArticle({ AI } as unknown as Env, 'https://news.example/picture')).toMatchObject({ ok: false })
    expect(AI.toMarkdown).not.toHaveBeenCalled()
  })

  it('reports a conversion that fails or throws as a page it could not read', async () => {
    serve(() => new Response(page('Words.'), { headers: { 'content-type': 'text/html' } }))
    const failing = { toMarkdown: async () => ({ format: 'error', error: 'unsupported' }) }
    expect(await fetchArticle({ AI: failing } as unknown as Env, 'https://news.example/a')).toMatchObject({ ok: false, reason: expect.stringContaining('unsupported') })
    const throwing = { toMarkdown: async () => Promise.reject(new Error('binding down')) }
    expect(await fetchArticle({ AI: throwing } as unknown as Env, 'https://news.example/a')).toMatchObject({ ok: false, reason: expect.stringContaining('binding down') })
  })
})

describe('Tracker.propose', () => {
  it('cuts a note to a bounded length', async () => {
    const url = 'https://news.example/long-note'
    await (await tracker()).propose({ source: { url, title: null }, note: 'n'.repeat(50_000), items: [{ question_id: 'hot', decider_id: 'ann', kind: 'says', occurred_on: null, quote: 'Some words from it.', reading: null, note: 'i'.repeat(50_000) }] }, 'model')
    const notes = await notesFor(url)
    expect(notes).toHaveLength(2)
    for (const n of notes) expect(n.body.length).toBeLessThanOrEqual(4000)
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
