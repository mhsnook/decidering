import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { isEditorRequest, isEditorToken } from '../../worker/editor.ts'
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
    expect(await res.json()).toEqual(path.endsWith('session') ? { ok: true } : { questions: [] })
  })
})

// A Preview deployed without the secret has no EDITOR_TOKEN. Nobody is an editor there.
describe('with no editor token configured', () => {
  const unset = [
    ['empty', { ...env, EDITOR_TOKEN: '' }],
    ['missing', { ...env, EDITOR_TOKEN: undefined }],
  ] as unknown as [string, Env][]

  it.each(unset)('accepts no token when the secret is %s', async (_, noSecret) => {
    for (const token of ['', 'undefined', 'null', EDITOR_TOKEN]) expect(await isEditorToken(token, noSecret)).toBe(false)
  })

  it.each(unset)('accepts no request when the secret is %s', async (_, noSecret) => {
    for (const authorization of ['Bearer ', 'Bearer undefined', `Bearer ${EDITOR_TOKEN}`]) {
      expect(await isEditorRequest(new Request('http://sporelight.test/', { headers: { authorization } }), noSecret)).toBe(false)
    }
  })
})
