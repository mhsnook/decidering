import { z } from 'zod'
import { ACT_KINDS, BEARINGS, POSITIONS, type ProposalDraft } from '../shared/schema.ts'

// The model that reads articles. Check the Workers AI catalogue for a planned
// deprecation date before changing it: an id past that date answers 410.
export const MODEL = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'

type Asked = { id: string; title: string; short_title: string; description: string | null; kind: 'position' | 'formal_act' }

// What the model is told about the question: the question itself, the
// sub-questions under it that are open, and for each person which of them are
// put to that person. The rules are the ones `buildTracker` applies: a measure
// is put to everyone in the body, or in its chamber; an ask only to the people
// it names or who hold an office it is put to on the day.
export type ReadingContext = {
  question: Asked
  subQuestions: (Asked & { is_ask: boolean })[]
  people: { id: string; name: string; questions: string[] }[]
}

export async function readingContext(db: D1Database, questionId: string, people: { id: string; name: string }[], day: string): Promise<ReadingContext | null> {
  const ids = JSON.stringify(people.map((p) => p.id))
  const [question, children, chambers, asked] = await db.batch([
    db.prepare(`SELECT id, title, short_title, description, kind FROM questions WHERE id = ?1`).bind(questionId),
    db
      .prepare(
        `SELECT q.id, q.title, q.short_title, q.description, q.kind, q.chamber,
           EXISTS (SELECT 1 FROM question_deciders l WHERE l.question_id = q.id) OR EXISTS (SELECT 1 FROM question_offices l WHERE l.question_id = q.id) AS is_ask
         FROM questions q
         WHERE q.parent_id = ?1 AND (q.status = 'open' OR q.closed_on > ?2)
         ORDER BY q.sort`,
      )
      .bind(questionId, day),
    db
      .prepare(
        `SELECT DISTINCT r.decider_id, s.chamber FROM roles r JOIN seats s ON s.id = r.seat_id
         WHERE r.decider_id IN (SELECT value FROM json_each(?1))
           AND (r.starts_on IS NULL OR r.starts_on <= ?2) AND (r.ends_on IS NULL OR ?2 < r.ends_on)`,
      )
      .bind(ids, day),
    db
      .prepare(
        `SELECT l.question_id, l.decider_id FROM question_deciders l JOIN questions q ON q.id = l.question_id
         WHERE q.parent_id = ?1 AND l.decider_id IN (SELECT value FROM json_each(?2))
         UNION
         SELECT l.question_id, h.decider_id FROM question_offices l JOIN questions q ON q.id = l.question_id JOIN office_holders h ON h.office_id = l.office_id
         WHERE q.parent_id = ?1 AND h.decider_id IN (SELECT value FROM json_each(?2))
           AND (h.starts_on IS NULL OR h.starts_on <= ?3) AND (h.ends_on IS NULL OR ?3 < h.ends_on)`,
      )
      .bind(questionId, ids, day),
  ])
  const root = question.results[0] as Asked | undefined
  if (!root) return null
  const subs = (children.results as (Asked & { chamber: string | null; is_ask: number })[]).map((q) => ({ ...q, is_ask: Boolean(q.is_ask) }))
  const chambersOf = new Map<string, Set<string | null>>()
  for (const row of chambers.results as { decider_id: string; chamber: string | null }[]) {
    chambersOf.set(row.decider_id, (chambersOf.get(row.decider_id) ?? new Set()).add(row.chamber))
  }
  const askedOf = new Set((asked.results as { question_id: string; decider_id: string }[]).map((r) => `${r.question_id} ${r.decider_id}`))
  return {
    question: { id: root.id, title: root.title, short_title: root.short_title, description: root.description, kind: root.kind },
    subQuestions: subs.map(({ chamber: _, ...q }) => q),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      questions: [
        root.id,
        ...subs
          .filter((q) => (q.is_ask ? askedOf.has(`${q.id} ${p.id}`) : !q.chamber || chambersOf.get(p.id)?.has(q.chamber)))
          .map((q) => q.id),
      ],
    })),
  }
}

const isoDate = z.iso.date()

// What the model is asked to return. Loose on purpose where the model is likely
// to stray (an unparseable date becomes null); strict on anything an editor
// would otherwise have to catch.
export const modelOutputSchema = z.object({
  acts: z.array(
    z.object({
      person_id: z.string(),
      question_id: z.string(),
      kind: z.enum(ACT_KINDS),
      quote: z.string(),
      occurred_on: z
        .string()
        .nullable()
        .transform((d) => (d && isoDate.safeParse(d).success ? d : null)),
      position: z.enum(POSITIONS),
      bearing: z.enum(BEARINGS),
      summary: z.string(),
      reason: z.string(),
    }),
  ),
})
export type ModelAct = z.infer<typeof modelOutputSchema>['acts'][number]

// The same shape for the model, as JSON Schema.
const { $schema: _, ...OUTPUT_JSON_SCHEMA } = z.toJSONSchema(z.object({ acts: z.array(modelOutputSchema.shape.acts.element.extend({ occurred_on: z.string().nullable() })) }), { target: 'draft-7' })

const SYSTEM = `You read one news article and list what it records named people doing or saying about one question.

An act is one thing one person did or said. Each act has a kind:
- says: words, in any medium (a statement, an interview, a post, a speech)
- commits: a formal, public, revocable commitment (cosponsoring a bill, signing a letter, taking a pledge)
- does: using the office itself (voting, scheduling a hearing, ratifying)

For each act give:
- person_id and question_id, taken only from the lists you are given; a person can only be read on the questions listed for them
- quote: words copied exactly from the article, character for character, with no ellipsis and no words added. For a statement, the person's own words. For a commitment or a use of office, the article's sentence that reports it
- occurred_on: the date the act happened as YYYY-MM-DD, or null if the article does not make it clear. This is not the article's date unless the article says the act happened that day
- position: what the act shows about where the person stands on that question (support, lean_support, mixed, lean_oppose, oppose). On a question that asks whether someone did a specific thing, support means they did it
- bearing: direct if the act is about the question itself, indirect if it is about something else that tells you about the question
- summary: one line, under 140 characters, saying where the act leaves the person on the question
- reason: one or two sentences for the editor saying why this act counts

Only list an act the article itself reports. A person merely being mentioned, quoted about something else, or described by someone else's opinion is not an act. Most articles record no act for most people: return an empty list when that is so.`

export function modelPrompt(context: ReadingContext, article: { url: string; title: string | null; date: string | null; text: string }, today: string) {
  const questions = [context.question, ...context.subQuestions].map((q) => ({
    question_id: q.id,
    title: q.title,
    description: q.description,
    asks_whether_they_did_it: q.kind === 'formal_act',
    is_sub_question_of: q.id === context.question.id ? null : context.question.id,
  }))
  const user = [
    `Today is ${today}.`,
    `Questions:\n${JSON.stringify(questions, null, 1)}`,
    `People, with the questions each can be read on:\n${JSON.stringify(context.people.map((p) => ({ person_id: p.id, name: p.name, question_ids: p.questions })), null, 1)}`,
    `Article: ${article.title ?? '(no title)'}\n${article.url}${article.date ? `\nDated ${article.date}` : ''}\n\n${article.text}`,
  ].join('\n\n')
  return {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'acts', schema: OUTPUT_JSON_SCHEMA, strict: true } },
    reasoning_effort: 'none',
    temperature: 0,
    max_completion_tokens: 4000,
  }
}

// For comparing a quote with the article: case, runs of whitespace, curly
// quotes, dashes and non-breaking spaces do not count as differences.
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[­​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const stripOuterQuotes = (quote: string) => quote.trim().replace(/^["']+|["']+$/g, '').trim()

export function quoteIsInArticle(quote: string, articleText: string): boolean {
  const needle = normalise(stripOuterQuotes(quote))
  return needle.length >= 10 && normalise(articleText).includes(needle)
}

export type Dropped = { act: Pick<ModelAct, 'person_id' | 'question_id' | 'quote'>; why: string }

export type Reading =
  | { ok: true; acts: ModelAct[]; dropped: Dropped[] }
  // The model did not answer, or answered with nothing that fits the schema.
  | { ok: false; reason: string }

// Pulls the model's answer out of what the binding returns. The catalogue
// gives an OpenAI-style completion; older Workers AI models put it in
// `response`, sometimes already parsed.
function answerOf(raw: unknown): unknown {
  const r = raw as { choices?: { message?: { content?: unknown } }[]; response?: unknown }
  const content = r?.choices?.[0]?.message?.content ?? r?.response
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return content
  }
}

export async function readArticle(
  env: Pick<Env, 'AI' | 'AI_GATEWAY'>,
  context: ReadingContext,
  article: { url: string; title: string | null; date: string | null; text: string },
  today: string,
): Promise<Reading> {
  let answer: unknown
  try {
    const raw = await env.AI.run(MODEL as never, modelPrompt(context, article, today) as never, { gateway: { id: env.AI_GATEWAY } })
    answer = answerOf(raw)
  } catch (e) {
    return { ok: false, reason: `The model call failed (${String(e).slice(0, 160)}).` }
  }
  const parsed = modelOutputSchema.safeParse(answer)
  if (!parsed.success) return { ok: false, reason: `The model's answer did not fit the expected shape (${parsed.error.issues[0]?.message ?? 'unknown'}).` }

  const allowed = new Map(context.people.map((p) => [p.id, new Set(p.questions)]))
  const acts: ModelAct[] = []
  const dropped: Dropped[] = []
  for (const act of parsed.data.acts) {
    const why = !allowed.has(act.person_id)
      ? 'names someone the article was not read for'
      : !allowed.get(act.person_id)!.has(act.question_id)
        ? 'is read on a question not put to that person'
        : !quoteIsInArticle(act.quote, article.text)
          ? 'quotes words that are not in the article'
          : null
    if (why) dropped.push({ act: { person_id: act.person_id, question_id: act.question_id, quote: act.quote }, why })
    else acts.push({ ...act, quote: stripOuterQuotes(act.quote).slice(0, 2000), summary: act.summary.trim().slice(0, 300), reason: act.reason.trim().slice(0, 1000) })
  }
  return { ok: true, acts, dropped }
}

// One proposal for the article, with one item per act. The model's reason for
// each act goes in that item's note, which only editors read.
export function draftFromReading(article: { url: string; title: string | null }, acts: ModelAct[], dropped: Dropped[], query: string | null): ProposalDraft {
  const lines = [
    `Read by ${MODEL}. Each quote below was found word for word in the text fetched from the article.`,
    dropped.length ? `${dropped.length} more act${dropped.length === 1 ? ' was' : 's were'} left out: ${dropped.map((d) => `"${d.act.quote.slice(0, 80)}" ${d.why}`).join('; ')}.` : null,
    query ? `Found by searching: ${query}` : null,
  ]
  return {
    source: { url: article.url, title: article.title?.slice(0, 300) || null },
    note: lines.filter(Boolean).join('\n'),
    items: acts.map((a) => ({
      question_id: a.question_id,
      decider_id: a.person_id,
      kind: a.kind,
      occurred_on: a.occurred_on,
      quote: a.quote,
      reading: a.position,
      bearing: a.bearing,
      summary: a.summary || null,
      note: `Model's reason: ${a.reason}`,
    })),
  }
}
