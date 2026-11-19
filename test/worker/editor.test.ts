import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { EDITOR_TOKEN } from './helpers.ts'

const call = (path: string, method: string, token?: string) =>
  exports.default.fetch(`http://sporelight.test${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} })

describe.each([
  ['/api/editor/session', 'GET'],
  ['/api/editor/news-search', 'POST'],
])('%s', (path, method) => {
  it('is refused without a token', async () => {
    expect((await call(path, method)).status).toBe(401)
  })

  it('is refused with the wrong token', async () => {
    expect((await call(path, method, `${EDITOR_TOKEN}x`)).status).toBe(401)
    expect((await call(path, method, EDITOR_TOKEN.slice(0, -1))).status).toBe(401)
  })

  it('is accepted with the editor token', async () => {
    const res = await call(path, method, EDITOR_TOKEN)
    expect(res.status).toBe(200)
    // This file seeds no questions, so the news search runs without searching.
    expect(await res.json()).toEqual(path.endsWith('session') ? { ok: true } : { questions: [], deferred: 0 })
  })
})

describe('/api/editor/read-article', () => {
  it('is refused without a token', async () => {
    expect((await call('/api/editor/read-article', 'POST')).status).toBe(401)
  })

  it('needs a web address and a question', async () => {
    expect((await call('/api/editor/read-article', 'POST', EDITOR_TOKEN)).status).toBe(400)
  })
})
