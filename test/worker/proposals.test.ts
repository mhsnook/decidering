import { env } from 'cloudflare:workers'
import { getServerByName } from 'partyserver'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Tracker } from '../../worker/tracker.ts'
import { post, proposal, rows, seed } from './helpers.ts'

const tracker = () => getServerByName<Env, Tracker>(env.Tracker, 'main')
const count = async (table: string) => (await rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n
const totals = async () => ({
  sources: await count('sources'),
  proposals: await count('proposals'),
  items: await count('proposal_items'),
  notes: await count('proposal_notes'),
})

beforeAll(seed)

describe('POST /api/proposals: refused input', () => {
  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON null', 'null'],
  ])('refuses %s', async (_, raw) => {
    const res = await post('/api/proposals', raw)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Expected a JSON body.' })
  })

  it.each([
    ['a JSON array', '[]'],
    ['a JSON string', '"I support it"'],
    ['a JSON number', '42'],
  ])('refuses %s with a 400 and writes nothing', async (_, raw) => {
    const before = await totals()
    expect((await post('/api/proposals', raw)).status).toBe(400)
    expect(await totals()).toEqual(before)
  })

  it.each([
    ['quote', { quote: 'too short' }],
    ['quote', { quote: 'x'.repeat(2001) }],
    ['source_url', { source_url: `https://news.example/${'x'.repeat(2000)}` }],
    ['source_url', { source_url: 'javascript:alert(document.cookie)' }],
    ['source_url', { source_url: 'data:text/html,<script>alert(1)</script>' }],
    ['source_url', { source_url: 'ftp://news.example/story' }],
    ['source_title', { source_title: 'x'.repeat(301) }],
    ['submitter_note', { submitter_note: 'x'.repeat(1001) }],
  ])('refuses a bad %s and writes nothing', async (field, bad) => {
    const before = await totals()
    const res = await post('/api/proposals', proposal(bad))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(new RegExp(`^${field}: `))
    expect(await totals()).toEqual(before)
  })

  it('ignores fields only the server or an editor sets', async () => {
    const url = 'https://news.example/forged-fields'
    const res = await post('/api/proposals', {
      ...proposal({ source_url: url }),
      id: 'forged-proposal',
      proposal_id: 'forged-proposal',
      act_id: 'forged-act',
      origin: 'model',
      status: 'accepted',
      position: 'oppose',
      summary: 'Forged summary',
      bearing: 'indirect',
      sort: 99,
      submitted_by: 'admin',
      reviewed_at: '2026-11-01',
    })
    expect(await res.json()).toEqual({ ok: true, duplicate: false })
    const [row] = await rows(
      `SELECT p.id AS proposal_id, p.origin, p.status AS proposal_status, p.submitted_by, p.reviewed_at,
              i.id, i.act_id, i.status, i.position, i.summary, i.bearing, i.sort
       FROM proposal_items i JOIN proposals p ON p.id = i.proposal_id JOIN sources s ON s.id = p.source_id WHERE s.url = ?`,
      url,
    )
    expect(row).toMatchObject({ origin: 'reader', proposal_status: 'pending', submitted_by: null, reviewed_at: null, status: 'pending', position: null, summary: null, bearing: 'direct', sort: 0 })
    expect([row.proposal_id, row.id, row.act_id]).not.toContain('forged-proposal')
    expect(row.act_id).not.toBe('forged-act')
  })

  it('answers a filled-in honeypot as if it worked and writes nothing', async () => {
    const before = await totals()
    const res = await post('/api/proposals', { ...proposal({ source_url: 'https://news.example/honeypot' }), website: 'https://spam.example' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await totals()).toEqual(before)
  })

  it.each([
    ['question', { question_id: 'no-such-question' }],
    ['decider', { decider_id: 'no-such-person' }],
  ])('refuses an unknown %s and leaves no source behind', async (_, bad) => {
    const before = await totals()
    const res = await post('/api/proposals', proposal({ ...bad, source_url: `https://news.example/unknown-${_}` }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown question or decider.' })
    expect(await totals()).toEqual(before)
  })

  it('limits one address to six posts a minute', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) {
      statuses.push((await post('/api/proposals', proposal({ quote: 'too short' }), '192.0.2.77')).status)
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 429])
  })
})

describe('POST /api/proposals: a new source', () => {
  it('writes a source, a pending proposal, one item and the submitter note', async () => {
    const url = 'https://news.example/new-source'
    const res = await post('/api/proposals', proposal({ source_url: `${url}#comments`, submitter_note: 'Second paragraph.' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: false })

    const [source] = await rows<{ id: string; title: string }>(`SELECT * FROM sources WHERE url = ?`, url)
    expect(source.title).toBe('Ann Alpha backs the bill')
    const proposals = await rows(`SELECT * FROM proposals WHERE source_id = ?`, source.id)
    expect(proposals).toMatchObject([{ origin: 'reader', status: 'pending', reviewed_at: null }])
    const items = await rows(`SELECT * FROM proposal_items WHERE proposal_id = ?`, proposals[0].id)
    expect(items).toMatchObject([
      {
        question_id: 'hot',
        decider_id: 'ann',
        kind: 'says',
        reading: 'support',
        bearing: 'direct',
        position: null,
        summary: null,
        status: 'pending',
        quote: 'I will vote for this bill when it comes up.',
        occurred_on: '2026-11-01',
      },
    ])
    expect(await rows(`SELECT kind, body, proposal_item_id FROM proposal_notes WHERE proposal_id = ?`, proposals[0].id)).toEqual([
      { kind: 'submitter', body: 'Second paragraph.', proposal_item_id: null },
    ])
  })

  it('writes no note when the submitter left none', async () => {
    await post('/api/proposals', proposal({ source_url: 'https://news.example/no-note' }))
    expect(await rows(`SELECT n.id FROM proposal_notes n JOIN proposals p ON p.id = n.proposal_id JOIN sources s ON s.id = p.source_id WHERE s.url = ?`, 'https://news.example/no-note')).toEqual([])
  })
})

describe('POST /api/proposals: duplicates from the same source', () => {
  const url = 'https://news.example/duplicates'
  const itemsFor = (decider: string) =>
    rows<{ id: string; status: string; quote: string }>(
      `SELECT i.id, i.status, i.quote FROM proposal_items i JOIN proposals p ON p.id = i.proposal_id JOIN sources s ON s.id = p.source_id WHERE s.url = ? AND i.decider_id = ? ORDER BY p.created_at`,
      url,
      decider,
    )
  const submit = async (overrides: Record<string, unknown>) =>
    (await (await post('/api/proposals', proposal({ source_url: url, ...overrides }))).json()) as { ok: boolean; duplicate: boolean }

  it('a pending item blocks the same person and question, whatever the quote', async () => {
    expect(await submit({ decider_id: 'bob' })).toEqual({ ok: true, duplicate: false })
    expect(await submit({ decider_id: 'bob', quote: 'A different sentence from the article.' })).toEqual({ ok: true, duplicate: true })
    expect(await submit({ decider_id: 'bob', source_url: `${url}#later` })).toEqual({ ok: true, duplicate: true })
    expect(await itemsFor('bob')).toHaveLength(1)
  })

  it('does not block another person or another question, and reuses the source', async () => {
    expect(await submit({ decider_id: 'eve' })).toEqual({ ok: true, duplicate: false })
    expect(await submit({ decider_id: 'bob', question_id: 'cold' })).toEqual({ ok: true, duplicate: false })
    expect(await rows(`SELECT id FROM sources WHERE url = ?`, url)).toHaveLength(1)
  })

  it('a published item blocks the same person and question', async () => {
    expect(await submit({ decider_id: 'fay' })).toEqual({ ok: true, duplicate: false })
    await env.DB.prepare(`UPDATE proposal_items SET status = 'accepted' WHERE id = ?`).bind((await itemsFor('fay'))[0].id).run()
    expect(await submit({ decider_id: 'fay', quote: 'A different sentence from the article.' })).toEqual({ ok: true, duplicate: true })
  })

  it('a rejected item blocks a reader only for the same quote', async () => {
    expect(await submit({ decider_id: 'ann', quote: 'The words that were turned down.' })).toEqual({ ok: true, duplicate: false })
    await env.DB.prepare(`UPDATE proposal_items SET status = 'rejected' WHERE id = ?`).bind((await itemsFor('ann'))[0].id).run()
    expect(await submit({ decider_id: 'ann', quote: 'The words that were turned down.' })).toEqual({ ok: true, duplicate: true })
    expect(await submit({ decider_id: 'ann', quote: 'A better quote from the same article.' })).toEqual({ ok: true, duplicate: false })
    expect((await itemsFor('ann')).map((i) => i.status)).toEqual(['rejected', 'pending'])
  })

  it('a rejected item blocks the news search whatever the quote', async () => {
    const newsUrl = 'https://news.example/rejected-lead'
    const draft = (quote: string) => ({ source: { url: newsUrl, title: null }, note: null, items: [{ question_id: 'hot', decider_id: 'ann', kind: 'says' as const, occurred_on: null, quote, reading: null }] })
    expect(await (await tracker()).propose(draft('Ann Alpha said something.'), 'news_search')).toEqual({ ok: true, queued: 1 })
    await env.DB.prepare(
      `UPDATE proposal_items SET status = 'rejected' WHERE proposal_id IN (SELECT p.id FROM proposals p JOIN sources s ON s.id = p.source_id WHERE s.url = ?)`,
    )
      .bind(newsUrl)
      .run()
    expect(await (await tracker()).propose(draft('Ann Alpha said something else.'), 'news_search')).toEqual({ ok: true, queued: 0 })
    expect(await (await tracker()).propose(draft('Ann Alpha said something.'), 'news_search')).toEqual({ ok: true, queued: 0 })
  })
})

// Last in the file: it fills the queue for every test after it.
describe('POST /api/proposals: a full queue', () => {
  it('refuses a new proposal once 500 are pending', async () => {
    const pending = await count(`proposals WHERE status = 'pending'`)
    await env.DB.prepare(`INSERT INTO sources (id, url, created_at) VALUES ('filler', 'https://news.example/filler', '2026-11-01')`).run()
    const fill = Array.from({ length: 500 - pending }, (_, i) =>
      env.DB.prepare(`INSERT INTO proposals (id, source_id, origin, created_at) VALUES (?, 'filler', 'reader', '2026-11-01')`).bind(`filler-${i}`),
    )
    await env.DB.batch(fill)
    expect(await count(`proposals WHERE status = 'pending'`)).toBe(500)

    const before = await totals()
    const res = await post('/api/proposals', proposal({ source_url: 'https://news.example/one-too-many' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'The review queue is full right now. Please try again later.' })
    expect(await totals()).toEqual(before)
  })

  it('takes proposals again once one is reviewed', async () => {
    await env.DB.prepare(`UPDATE proposals SET status = 'reviewed' WHERE id = 'filler-0'`).run()
    const res = await post('/api/proposals', proposal({ source_url: 'https://news.example/after-review' }))
    expect(await res.json()).toEqual({ ok: true, duplicate: false })
  })
})
