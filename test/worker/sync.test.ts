import { beforeAll, describe, expect, it } from 'vitest'
import { EDITOR_TOKEN, type Frame, partySocket, partyWrite, post, proposal, rows, seed, until } from './helpers.ts'

const body = { id: 'new-body', slug: 'new-body', name: 'New Body', jurisdiction: null, description: null, is_demo: false, sort: 9, next_term_on: null, next_term_label: null }
const rowsOn = (frames: Frame[], channel: string) => frames.filter((f) => f.channel === channel).flatMap((f) => f.ops.map((op) => op.value))
const insertBody = [{ channel: 'bodies', ops: [{ type: 'insert', value: body }] }]

beforeAll(async () => {
  await seed()
  // One proposal with a submitter note, so proposal_notes has a row to withhold.
  const res = await post('/api/proposals', proposal({ submitter_note: 'Only editors should read this.' }))
  expect(await res.json()).toEqual({ ok: true, duplicate: false })
})

describe('writes through the party endpoint', () => {
  it('refuses an anonymous write to a public collection', async () => {
    const res = await partyWrite(insertBody)
    expect(res.status).toBe(401)
    expect(await rows(`SELECT id FROM bodies WHERE id = 'new-body'`)).toEqual([])
  })

  it('refuses a write with the wrong token', async () => {
    const res = await partyWrite(insertBody, 'not-the-token')
    expect(res.status).toBe(401)
    expect(await rows(`SELECT id FROM bodies WHERE id = 'new-body'`)).toEqual([])
  })

  it('refuses an anonymous comment, which readers post through the Worker instead', async () => {
    const comment = { id: 'c1', thread_id: 'hot:ann', author_name: 'x', body: 'y', created_at: '2026-11-19T00:00:00Z' }
    expect((await partyWrite([{ channel: 'comments', ops: [{ type: 'insert', value: comment }] }])).status).toBe(401)
    expect(await rows(`SELECT id FROM comments`)).toEqual([])
  })

  it('takes an editor write and stores it', async () => {
    const res = await partyWrite(insertBody, EDITOR_TOKEN)
    expect(res.status).toBe(200)
    expect(await rows(`SELECT id, name FROM bodies WHERE id = 'new-body'`)).toEqual([{ id: 'new-body', name: 'New Body' }])
  })

  it('refuses an editor insert to comments, which only allows delete', async () => {
    const comment = { id: 'c2', thread_id: 'hot:ann', author_name: 'x', body: 'y', created_at: '2026-11-19T00:00:00Z' }
    expect((await partyWrite([{ channel: 'comments', ops: [{ type: 'insert', value: comment }] }], EDITOR_TOKEN)).status).toBe(403)
  })
})

describe('what a socket is sent', () => {
  it('sends an anonymous reader the public tables and no proposal notes', async () => {
    const reader = await partySocket()
    await until(() => reader.channels().has('bodies') && reader.channels().has('questions'))
    const before = reader.frames.length
    reader.send({ subscribe: 'proposal_notes' })
    await until(() => reader.frames.slice(before).some((f) => f.channel === 'proposal_notes'))
    // A refused subscribe is answered with an empty reset, so the client's load
    // settles; what matters is that it carries no rows.
    expect(rowsOn(reader.frames, 'proposal_notes')).toEqual([])
    reader.close()
  })

  it.each([
    ['a wrong token', 'not-the-token'],
    ['a prefix of the token', EDITOR_TOKEN.slice(0, -1)],
  ])('treats a socket with %s as a reader', async (_, token) => {
    const socket = await partySocket(token)
    await until(() => socket.channels().has('bodies'))
    const before = socket.frames.length
    socket.send({ subscribe: 'proposal_notes' })
    await until(() => socket.frames.slice(before).some((f) => f.channel === 'proposal_notes'))
    expect(rowsOn(socket.frames, 'proposal_notes')).toEqual([])
    socket.close()
  })

  it('sends an editor the proposal notes on connect', async () => {
    const editor = await partySocket(EDITOR_TOKEN)
    await until(() => editor.channels().has('proposal_notes'))
    expect(rowsOn(editor.frames, 'proposal_notes').map((n) => n.body)).toContain('Only editors should read this.')
    editor.close()
  })

  it('broadcasts a new proposal note to the editor and not to the reader', async () => {
    const reader = await partySocket()
    const editor = await partySocket(EDITOR_TOKEN)
    await until(() => reader.channels().has('bodies') && editor.channels().has('proposal_notes'))
    const seen = { reader: reader.frames.length, editor: editor.frames.length }

    const res = await post('/api/proposals', proposal({ source_url: 'https://news.example/live', submitter_note: 'A second private note.' }))
    expect(await res.json()).toEqual({ ok: true, duplicate: false })

    // A later write is sent after everything the proposal committed, so once the
    // reader has it, any note that was going to reach the reader already has.
    const marker = { ...body, id: 'after-live', slug: 'after-live' }
    expect((await partyWrite([{ channel: 'bodies', ops: [{ type: 'insert', value: marker }] }], EDITOR_TOKEN)).status).toBe(200)
    await until(() => rowsOn(reader.frames.slice(seen.reader), 'bodies').some((b) => b.id === 'after-live'))

    // The reader is sent the public half of the same proposal.
    expect(rowsOn(reader.frames.slice(seen.reader), 'sources').map((src) => src.url)).toContain('https://news.example/live')
    expect(rowsOn(reader.frames, 'proposal_notes')).toEqual([])
    await until(() => editor.frames.slice(seen.editor).some((f) => f.channel === 'proposal_notes'))
    expect(rowsOn(editor.frames.slice(seen.editor), 'proposal_notes').map((n) => n.body)).toEqual(['A second private note.'])
    reader.close()
    editor.close()
  })
})
