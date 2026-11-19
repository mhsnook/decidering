import { env, exports } from 'cloudflare:workers'
import { EDITOR_TOKEN } from './editor-token.ts'

export { EDITOR_TOKEN }

// One table of each kind a proposal or a news search reads. Each test file gets
// its own database, so a file seeds once and its tests share the rows.
//
//   congress  the body the questions are listed under; Ann, Eve and Fay sit in it
//   senate    a second body the hot question is also put to; Bob sits in it
//   demo      a demo body with a hot question of its own; Cara sits in it
//   Dan sits nowhere
export async function seed() {
  await env.DB.batch(
    [
      `INSERT INTO bodies (id, slug, name, is_demo) VALUES
        ('congress', 'congress', 'Congress', 0), ('senate', 'senate', 'Senate', 0), ('demo', 'demo', 'Demo Council', 1)`,
      `INSERT INTO deciders (id, slug, name, sort_name) VALUES
        ('ann', 'ann-alpha', 'Ann Alpha', 'Alpha, Ann'), ('bob', 'bob-beta', 'Bob Beta', 'Beta, Bob'),
        ('cara', 'cara-gamma', 'Cara Gamma', 'Gamma, Cara'), ('dan', 'dan-delta', 'Dan Delta', 'Delta, Dan'),
        ('eve', 'eve-epsilon', 'Eve Epsilon', 'Epsilon, Eve'), ('fay', 'fay-zeta', 'Fay Zeta', 'Zeta, Fay')`,
      `INSERT INTO seats (id, body_id, label) VALUES
        ('s-ann', 'congress', 'Seat 1'), ('s-eve', 'congress', 'Seat 2'), ('s-fay', 'congress', 'Seat 3'), ('s-bob', 'senate', 'Seat 1'), ('s-cara', 'demo', 'Seat 1')`,
      `INSERT INTO roles (id, seat_id, decider_id) VALUES
        ('r-ann', 's-ann', 'ann'), ('r-eve', 's-eve', 'eve'), ('r-fay', 's-fay', 'fay'), ('r-bob', 's-bob', 'bob'), ('r-cara', 's-cara', 'cara')`,
      `INSERT INTO questions (id, slug, body_id, kind, title, short_title, is_hot, status, closed_on) VALUES
        ('hot', 'hot', 'congress', 'position', 'Hot question?', 'Hot Topic', 1, 'open', NULL),
        ('cold', 'cold', 'congress', 'position', 'Cold question?', 'Cold Topic', 0, 'open', NULL),
        ('closed', 'closed', 'congress', 'position', 'Closed question?', 'Closed Topic', 1, 'lapsed', '2020-01-01'),
        ('closing', 'closing', 'congress', 'position', 'Closing question?', 'Closing Topic', 1, 'lapsed', '2999-01-01'),
        ('demo-hot', 'demo-hot', 'demo', 'position', 'Demo question?', 'Demo Topic', 1, 'open', NULL)`,
      `INSERT INTO question_bodies (id, question_id, body_id) VALUES ('qb-hot-senate', 'hot', 'senate')`,
    ].map((sql) => env.DB.prepare(sql)),
  )
}

let ip = 0
// The Worker limits each address to a few posts a minute, so every call comes
// from a new one unless the test names it.
export function post(path: string, body: unknown, from = `10.0.${Math.floor(++ip / 250)}.${ip % 250}`, token?: string) {
  return exports.default.fetch(`http://sporelight.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': from, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

export const proposal = (overrides: Record<string, unknown> = {}) => ({
  question_id: 'hot',
  decider_id: 'ann',
  kind: 'says',
  reading: 'support',
  quote: 'I will vote for this bill when it comes up.',
  source_url: 'https://news.example/story-1',
  source_title: 'Ann Alpha backs the bill',
  occurred_on: '2026-11-01',
  submitter_note: null,
  ...overrides,
})

export const rows = async <T = Record<string, unknown>>(sql: string, ...binds: unknown[]) =>
  (await env.DB.prepare(sql).bind(...binds).all<T>()).results

const PARTY = 'http://sporelight.test/parties/tracker/main?proto=party-db'

// What the browser's party-db client sends on a write.
export function partyWrite(batches: unknown, token?: string) {
  return exports.default.fetch(PARTY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(batches),
  })
}

export type Frame = { channel: string; seq: number | string; ops: { type: string; value: Record<string, unknown> }[] }

// A party-db socket as the browser opens one, recording every batch it is sent.
export async function partySocket(token?: string) {
  const res = await exports.default.fetch(`${PARTY}${token ? `&token=${token}` : ''}`, { headers: { upgrade: 'websocket' } })
  const ws = res.webSocket
  if (!ws) throw new Error(`no socket: ${res.status} ${await res.text()}`)
  const frames: Frame[] = []
  ws.addEventListener('message', (e) => {
    frames.push(JSON.parse(e.data as string))
  })
  ws.accept()
  return {
    frames,
    send: (frame: unknown) => ws.send(JSON.stringify(frame)),
    channels: () => new Set(frames.map((f) => f.channel)),
    close: () => ws.close(),
  }
}

export async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}
