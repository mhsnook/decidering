import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { post, rows, seed } from './helpers.ts'

const comment = (overrides: Record<string, unknown> = {}) => ({ question_id: 'hot', decider_id: 'ann', author_name: 'reader-one', body: 'Is there a source for this?', ...overrides })
const count = async () => (await rows<{ n: number }>(`SELECT COUNT(*) AS n FROM comments`))[0].n

beforeAll(seed)

describe('POST /api/comments', () => {
  it.each([
    ['author_name', { author_name: '   ' }],
    ['author_name', { author_name: 'x'.repeat(61) }],
    ['body', { body: '' }],
    ['body', { body: 'x'.repeat(2001) }],
    ['decider_id', { decider_id: '' }],
  ])('names the bad field: %s', async (field, bad) => {
    const res = await post('/api/comments', comment(bad))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(new RegExp(`^${field}: `))
    expect(await count()).toBe(0)
  })

  it.each([
    ['question', { question_id: 'no-such-question' }],
    ['decider', { decider_id: 'no-such-person' }],
  ])('refuses an unknown %s', async (_, bad) => {
    const res = await post('/api/comments', comment(bad))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown question or decider.' })
    expect(await count()).toBe(0)
  })

  it('answers a filled-in honeypot as if it worked and writes nothing', async () => {
    const res = await post('/api/comments', { ...comment(), website: 'x' })
    expect(await res.json()).toEqual({ ok: true })
    expect(await count()).toBe(0)
  })

  it('ignores an id, thread or timestamp the reader sends', async () => {
    const res = await post('/api/comments', comment({ id: 'forged', thread_id: 'cold:bob', created_at: '2001-01-01T00:00:00Z', body: 'Forged fields.' }))
    expect(await res.json()).toEqual({ ok: true })
    const [row] = await rows<{ id: string; thread_id: string; created_at: string }>(`SELECT id, thread_id, created_at FROM comments WHERE body = 'Forged fields.'`)
    expect(row.id).not.toBe('forged')
    expect(row.thread_id).toBe('hot:ann')
    expect(row.created_at.startsWith('2001')).toBe(false)
    await env.DB.prepare(`DELETE FROM comments`).run()
  })

  it('writes a trimmed comment to the thread for that person and question', async () => {
    const res = await post('/api/comments', comment({ author_name: '  reader-one ', body: ' Is there a source for this?\n' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await rows(`SELECT thread_id, author_name, body FROM comments`)).toEqual([
      { thread_id: 'hot:ann', author_name: 'reader-one', body: 'Is there a source for this?' },
    ])
  })
})
