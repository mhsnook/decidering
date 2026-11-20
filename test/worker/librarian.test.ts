import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { askLibrarian, type LibrarianInput } from '../../worker/librarian.ts'
import { guidanceFor, modelPrompt, readingContext } from '../../worker/reader.ts'
import { EDITOR_TOKEN, partySocket, post, rows, seed, until } from './helpers.ts'

beforeAll(seed)

const input = (over: Partial<LibrarianInput> = {}): LibrarianInput => ({
  question_id: 'hot',
  message: 'Ann is a yes on the smaller step and a no on the whole.',
  history: [],
  card: {
    source_title: 'Ann Alpha on the bill',
    entries: [{ key: 'entry-ann', name: 'Ann Alpha', words: 'I support it, but only with the amendment.', passage: null, reading: 'support', weight: 'clear', related: [] }],
    related_questions: [{ question_id: 'cold', title: 'Cold question?', kind: 'smaller_step' }],
  },
  ...over,
})

// An env whose model returns `answer`, and which records what it was sent.
function withModel(answer: unknown) {
  const sent: { model: string; body: { messages: { content: string }[] }; options: { gateway: { id: string } } }[] = []
  const AI = {
    run: async (model: string, body: never, options: never) => {
      sent.push({ model, body, options })
      if (answer instanceof Error) throw answer
      return { choices: [{ message: { content: JSON.stringify(answer) } }] }
    },
  }
  return { env: { ...env, AI } as unknown as Env, sent }
}

const question = { title: 'Hot question?', description: null }

describe('askLibrarian', () => {
  it('returns the model’s changes for entries on the card and questions they were offered, and drops the rest', async () => {
    const model = withModel({
      reply: 'Changed Ann Alpha.',
      changes: [
        {
          entry_key: 'entry-ann',
          reading: 'oppose',
          weight: null,
          related: [
            { question_id: 'cold', reading: 'support' },
            { question_id: 'closed', reading: 'support' },
          ],
        },
        { entry_key: 'entry-nobody', reading: 'support', weight: null, related: [] },
      ],
      remember: null,
    })
    const asked = await askLibrarian(model.env, input(), question, [])
    expect(asked).toEqual({
      ok: true,
      answer: { reply: 'Changed Ann Alpha.', changes: [{ entry_key: 'entry-ann', reading: 'oppose', weight: null, related: [{ question_id: 'cold', reading: 'support' }] }], remember: null },
    })
  })

  it('goes through the gateway in config, and tells the model the card, the message and the rules kept earlier', async () => {
    const model = withModel({ reply: 'Nothing to change.', changes: [], remember: null })
    await askLibrarian(model.env, input(), question, ['A general yes on health care is not a yes on this bill.'])
    expect(model.sent[0].options).toEqual({ gateway: { id: env.AI_GATEWAY } })
    const prompt = model.sent[0].body.messages[1].content
    expect(prompt).toContain('entry-ann')
    expect(prompt).toContain('Ann is a yes on the smaller step')
    expect(prompt).toContain('A general yes on health care is not a yes on this bill.')
  })

  it.each([
    ['a model call that fails', new Error('rate limited')],
    ['an answer out of shape', { reply: 'ok', changes: [{ entry_key: 'entry-ann', reading: 'definitely' }] }],
  ])('answers 502 for %s', async (_, answer) => {
    const asked = await askLibrarian(withModel(answer).env, input(), question, [])
    expect(asked).toMatchObject({ ok: false, status: 502 })
  })
})

describe('/api/editor/librarian', () => {
  it('is refused without the editor token', async () => {
    expect((await post('/api/editor/librarian', input())).status).toBe(401)
    expect((await post('/api/editor/librarian', input(), undefined, `${EDITOR_TOKEN}x`)).status).toBe(401)
  })

  it('refuses a body that is not a message with a card', async () => {
    expect((await post('/api/editor/librarian', { question_id: 'hot', message: '' }, undefined, EDITOR_TOKEN)).status).toBe(400)
  })

  it('answers 404 for a question that does not exist', async () => {
    expect((await post('/api/editor/librarian', input({ question_id: 'no-such-question' }), undefined, EDITOR_TOKEN)).status).toBe(404)
  })
})

describe('what the librarian keeps', () => {
  it('is given to the article reader for that question and no other, oldest first', async () => {
    await env.DB.prepare(
      `INSERT INTO question_guidance (id, question_id, body, created_at) VALUES
        ('g-2', 'hot', 'Second rule.', '2026-11-02T00:00:00Z'), ('g-1', 'hot', 'First rule.', '2026-11-01T00:00:00Z'), ('g-cold', 'cold', 'A rule for another question.', '2026-11-01T00:00:00Z')`,
    ).run()
    expect(await guidanceFor(env.DB, 'hot')).toEqual(['First rule.', 'Second rule.'])
    const context = await readingContext(env.DB, 'hot', [{ id: 'ann', name: 'Ann Alpha' }], '2026-11-19')
    const prompt = modelPrompt(context!, { url: 'https://news.example/a', title: null, date: null, text: 'Some text.' }, '2026-11-19').messages[1].content
    expect(prompt).toContain('- First rule.\n- Second rule.')
    expect(prompt).not.toContain('A rule for another question.')
  })

  it('is sent to editors and never to anonymous readers', async () => {
    const rowsOn = (frames: { channel: string; ops: { value: Record<string, unknown> }[] }[]) => frames.filter((f) => f.channel === 'question_guidance').flatMap((f) => f.ops.map((op) => op.value.body))
    const reader = await partySocket()
    const editor = await partySocket(EDITOR_TOKEN)
    await until(() => rowsOn(editor.frames).length === 3)
    await until(() => reader.channels().has('questions'))
    const before = reader.frames.length
    reader.send({ subscribe: 'question_guidance' })
    // A refused subscribe is answered with an empty reset.
    await until(() => reader.frames.slice(before).some((f) => f.channel === 'question_guidance'))
    expect(rowsOn(reader.frames)).toEqual([])
    expect(await rows(`SELECT COUNT(*) AS n FROM question_guidance`)).toEqual([{ n: 3 }])
    reader.close()
    editor.close()
  })
})
