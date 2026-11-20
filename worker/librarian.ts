import { z } from 'zod'
import { DIRECTIONS, WEIGHTS } from '../shared/schema.ts'
import { MODEL } from './reader.ts'

// What the editor's browser sends: the message, the chat so far, and the open
// card as it stands in the form, since none of that is stored until publishing.
export const librarianInputSchema = z.object({
  question_id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  history: z.array(z.object({ who: z.enum(['editor', 'librarian']), text: z.string().max(2000) })).max(20),
  card: z.object({
    source_title: z.string().max(300).nullable(),
    entries: z
      .array(
        z.object({
          key: z.string(),
          name: z.string(),
          words: z.string().max(2000),
          passage: z.string().max(2000).nullable(),
          reading: z.enum(DIRECTIONS).nullable(),
          weight: z.enum(WEIGHTS).nullable(),
          related: z.array(z.object({ question_id: z.string(), reading: z.enum(DIRECTIONS) })),
        }),
      )
      .max(12),
    // The other questions an entry on this card may be read on.
    related_questions: z.array(z.object({ question_id: z.string(), title: z.string(), kind: z.string() })).max(20),
  }),
})
export type LibrarianInput = z.infer<typeof librarianInputSchema>

const answerSchema = z.object({
  reply: z.string(),
  changes: z.array(
    z.object({
      entry_key: z.string(),
      reading: z.enum(DIRECTIONS).nullable(),
      weight: z.enum(WEIGHTS).nullable(),
      related: z.array(z.object({ question_id: z.string(), reading: z.enum([...DIRECTIONS, 'none']) })),
    }),
  ),
  remember: z.string().nullable(),
})
export type LibrarianAnswer = z.infer<typeof answerSchema>

const { $schema: _, ...ANSWER_JSON_SCHEMA } = z.toJSONSchema(answerSchema, { target: 'draft-7' })

const SYSTEM = `You help an editor review what a news article records people doing or saying about one question. The editor sees a card with one entry per person. Each entry has the person's words, which way they point on the question (support; lean_support for probable support that the words leave uncertain; mixed; oppose) and how much they count (passing, clear, concrete). An entry can also be read on related questions, such as a smaller step toward the same proposal.

The editor writes one of two things, or both:
- a correction to this card. Return it in changes: the entry_key, the new reading and weight (null for either leaves it as it is), and any readings on related questions to add or change ("none" removes one). Only use entry keys and question ids you were given. Change nothing the editor did not ask for.
- a rule for reading this question in every article, such as what a common phrase really signals. Return it in remember as one plain sentence that stands alone. If the message is only a correction to this card, remember is null.

reply is one or two plain sentences for the editor saying what you changed and what you will remember. Nothing is published until the editor publishes.`

export type Asked = { ok: true; answer: LibrarianAnswer } | { ok: false; status: number; error: string }

// Asks the model what the editor's message changes on the card and what, if
// anything, it should keep for the question. Writes nothing.
export async function askLibrarian(env: Pick<Env, 'AI' | 'AI_GATEWAY'>, input: LibrarianInput, question: { title: string; description: string | null }, guidance: string[]): Promise<Asked> {
  const user = [
    `Question: ${question.title}${question.description ? `\n${question.description}` : ''}`,
    guidance.length ? `Rules editors gave earlier for this question:\n${guidance.map((g) => `- ${g}`).join('\n')}` : null,
    `Related questions:\n${JSON.stringify(input.card.related_questions, null, 1)}`,
    `The card, from "${input.card.source_title ?? 'an untitled source'}":\n${JSON.stringify(input.card.entries.map(({ key, ...e }) => ({ entry_key: key, ...e })), null, 1)}`,
    input.history.length ? `The conversation so far:\n${input.history.map((m) => `${m.who === 'editor' ? 'Editor' : 'You'}: ${m.text}`).join('\n')}` : null,
    `Editor: ${input.message}`,
  ]
  let content: unknown
  try {
    const raw = (await env.AI.run(
      MODEL as never,
      {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user.filter(Boolean).join('\n\n') },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: ANSWER_JSON_SCHEMA, strict: true } },
        reasoning_effort: 'none',
        temperature: 0,
        max_completion_tokens: 1500,
      } as never,
      { gateway: { id: env.AI_GATEWAY } },
    )) as { choices?: { message?: { content?: unknown } }[]; response?: unknown }
    content = raw?.choices?.[0]?.message?.content ?? raw?.response
    if (typeof content === 'string') content = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch (e) {
    return { ok: false, status: 502, error: `The librarian could not answer (${String(e).slice(0, 160)}).` }
  }
  const parsed = answerSchema.safeParse(content)
  if (!parsed.success) return { ok: false, status: 502, error: 'The librarian’s answer did not fit the expected shape.' }

  // A change is kept only for an entry on the card and a question it was offered.
  const keys = new Set(input.card.entries.map((e) => e.key))
  const offered = new Set(input.card.related_questions.map((q) => q.question_id))
  const changes = parsed.data.changes
    .filter((c) => keys.has(c.entry_key))
    .map((c) => ({ ...c, related: c.related.filter((r) => offered.has(r.question_id)) }))
  return { ok: true, answer: { reply: parsed.data.reply.trim().slice(0, 1000), changes, remember: parsed.data.remember?.trim().slice(0, 500) || null } }
}
