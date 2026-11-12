import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { evidenceKindSchema, positionSchema, type SubmissionInput } from '../shared/schema.ts'
import type { SubmitResult } from './tracker.ts'

const MODEL = 'claude-opus-5-5'
const MAX_CONTINUATIONS = 4

const findingsSchema = z.object({
  findings: z.array(
    z.object({
      decider_id: z.string(),
      kind: evidenceKindSchema,
      signals: positionSchema,
      quote: z.string(),
      source_url: z.string(),
      source_title: z.string(),
      occurred_on: z.string(),
      why: z.string(),
    }),
  ),
})

type HotQuestion = { id: string; title: string; description: string | null; body_id: string; body_name: string }
type RosterRow = { id: string; name: string; seat: string; role: string }

export type NewsReport = { skipped?: string; questions: { question: string; found: number; queued: number }[] }

type Submitter = { submit(input: SubmissionInput, origin: 'news_search'): Promise<SubmitResult> }

export async function searchNews(env: Env, tracker: Submitter): Promise<NewsReport> {
  if (!env.ANTHROPIC_API_KEY) return { skipped: 'ANTHROPIC_API_KEY is not set', questions: [] }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const hot = await env.DB.prepare(
    `SELECT q.id, q.title, q.description, q.body_id, b.name AS body_name
     FROM questions q JOIN bodies b ON b.id = q.body_id
     WHERE q.is_hot = 1 AND b.is_demo = 0`,
  ).all<HotQuestion>()

  const report: NewsReport = { questions: [] }
  for (const question of hot.results) {
    const roster = await env.DB.prepare(
      `SELECT d.id, d.name, s.label AS seat, r.kind AS role
       FROM roles r JOIN seats s ON s.id = r.seat_id JOIN deciders d ON d.id = r.decider_id
       WHERE s.body_id = ? ORDER BY d.sort_name`,
    )
      .bind(question.body_id)
      .all<RosterRow>()
    const known = new Set(roster.results.map((r) => r.id))

    const findings = await findStatements(client, question, roster.results)
    let queued = 0
    for (const f of findings) {
      // The model's output is a lead for a human reviewer, never a fact: anything
      // that doesn't validate is dropped, and everything else lands as pending.
      if (!known.has(f.decider_id)) continue
      const input = toSubmission(question.id, f)
      if (!input) continue
      const result = await tracker.submit(input, 'news_search')
      if (result.ok && !result.duplicate) queued++
      if (!result.ok && result.status === 429) break
    }
    report.questions.push({ question: question.title, found: findings.length, queued })
  }
  return report
}

function toSubmission(questionId: string, f: z.infer<typeof findingsSchema>['findings'][number]): SubmissionInput | null {
  if (!/^https?:\/\//.test(f.source_url) || !/^\d{4}-\d{2}-\d{2}$/.test(f.occurred_on) || f.quote.trim().length < 10) {
    return null
  }
  return {
    question_id: questionId,
    decider_id: f.decider_id,
    kind: f.kind,
    signals: f.signals,
    quote: f.quote.trim().slice(0, 2000),
    source_url: f.source_url,
    source_title: f.source_title.slice(0, 300) || null,
    occurred_on: f.occurred_on,
    submitter_note: f.why.slice(0, 1000) || null,
  }
}

async function findStatements(client: Anthropic, question: HotQuestion, roster: RosterRow[]) {
  const prompt = `You are helping maintain a public tracker of where decision-makers stand on open questions. A human editor reviews everything you find before it is published, and they need a verbatim quote and a working link to do that.

Body: ${question.body_name}
Question: ${question.title}
${question.description ?? ''}

Search recent news for statements from the last 30 days in which a person on the roster below takes, changes, or clarifies a position on this question. Good finds are on-the-record: a direct quote in a news article, a press release, a post from their own account, a vote, or a formal act such as signing on to a specific measure.

For each find, return the person's id from the roster, the quote exactly as the source gives it, the URL of the page where you read it, the date the statement was made, what it signals, and one sentence on why it matters. Leave out anything where you could not read the quote on the page yourself, where the speaker is someone describing the person's view rather than the person, or where the person is not on the roster. Returning no findings is a normal result on a quiet week.

Roster (id | name | seat | role):
${roster.map((r) => `${r.id} | ${r.name} | ${r.seat} | ${r.role}`).join('\n')}`

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(findingsSchema) },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }],
      messages,
    })
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content })
      continue
    }
    if (response.stop_reason !== 'end_turn') return []
    return response.parsed_output?.findings ?? []
  }
  return []
}
