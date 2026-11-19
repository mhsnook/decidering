import { leadFromHit, rosterMatcher, type RosterEntry, type SearchHit } from './leads.ts'
import type { ProposalDraft } from '../shared/schema.ts'
import type { SubmitResult } from './tracker.ts'

const GATEWAY = 'default'
const PROVIDER = 'exa'
const RESULTS_PER_QUERY = 10

type HotQuestion = { id: string; short_title: string; body_id: string; body_name: string }

export type NewsReport = { error?: string; questions: { question: string; hits: number; queued: number }[] }

type Submitter = { propose(draft: ProposalDraft, origin: 'news_search'): Promise<SubmitResult> }

function queriesFor(question: HotQuestion, now: Date): string[] {
  const month = now.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const topic = `"${question.short_title}" ${question.body_name}`
  return [`${topic} statement ${month}`, `${topic} announces support`, `${topic} opposes`, `${topic} cosponsor OR endorses OR votes`]
}

// Searches the news for each question marked as in the news and queues every
// hit that names someone on the roster as a lead for an editor. Search results
// carry an excerpt, not a checked quote, so nothing here is ever published
// without review.
export async function searchNews(env: Env, tracker: Submitter, now: Date = new Date()): Promise<NewsReport> {
  const hot = await env.DB.prepare(
    `SELECT q.id, q.short_title, q.body_id, b.name AS body_name
     FROM questions q JOIN bodies b ON b.id = q.body_id
     WHERE q.is_hot = 1 AND b.is_demo = 0 AND (q.status = 'open' OR q.closed_on > ?)`,
  )
    .bind(now.toISOString().slice(0, 10))
    .all<HotQuestion>()

  const report: NewsReport = { questions: [] }
  for (const question of hot.results) {
    const roster = await env.DB.prepare(
      `SELECT DISTINCT d.id, d.name, d.sort_name
       FROM roles r JOIN seats s ON s.id = r.seat_id JOIN deciders d ON d.id = r.decider_id
       WHERE s.body_id = ?1 OR s.body_id IN (SELECT body_id FROM question_bodies WHERE question_id = ?2)`,
    )
      .bind(question.body_id, question.id)
      .all<RosterEntry>()
    const match = rosterMatcher(roster.results)

    let hits = 0
    let queued = 0
    for (const query of queriesFor(question, now)) {
      const response = await env.AI.websearch({ gatewayId: GATEWAY, provider: PROVIDER, query, limit: RESULTS_PER_QUERY }).catch((e: unknown) => e)
      if (!(response instanceof Response) || !response.ok) {
        const detail = response instanceof Response ? `${response.status}: ${(await response.text()).slice(0, 200)}` : String(response).slice(0, 200)
        report.error = `Web search failed (${detail})`
        report.questions.push({ question: question.short_title, hits, queued })
        return report
      }
      const { items } = (await response.json()) as { items: SearchHit[] }
      hits += items.length
      for (const hit of items) {
        const lead = leadFromHit(hit, question.id, query, match)
        if (!lead) continue
        const result = await tracker.propose(lead, 'news_search')
        if (result.ok) queued += result.queued
        if (!result.ok && result.status === 429) {
          report.error = result.error
          report.questions.push({ question: question.short_title, hits, queued })
          return report
        }
      }
    }
    report.questions.push({ question: question.short_title, hits, queued })
  }
  return report
}
