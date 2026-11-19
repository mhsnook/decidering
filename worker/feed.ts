import type { Act, Body, Decider, Question, QuestionBody, Reading, Report, Role, Seat, Source } from '../shared/schema.ts'
import { buildTracker } from '../src/lib/build-tracker.ts'
import { FEED_PAGE, buildFeed } from '../src/lib/feed.ts'
import { atomFeed } from './atom.ts'

// D1 stores booleans as 0 and 1.
const flag = <T extends Record<string, unknown>>(rows: T[], ...columns: string[]) =>
  rows.map((row) => ({ ...row, ...Object.fromEntries(columns.map((c) => [c, row[c] === 1 || row[c] === true])) }))

// The published record, read straight from D1. Proposals are never read here.
async function loadRecord(db: D1Database) {
  const tables = ['bodies', 'deciders', 'seats', 'roles', 'questions', 'question_bodies', 'sources', 'acts', 'reports', 'readings'] as const
  const results = await db.batch(tables.map((t) => db.prepare(`SELECT * FROM ${t}`)))
  const [bodies, deciders, seats, roles, questions, questionBodies, sources, acts, reports, readings] = results.map((r) => r.results as Record<string, unknown>[])
  return {
    bodies: flag(bodies, 'is_demo') as unknown as Body[],
    deciders: deciders as unknown as Decider[],
    seats: flag(seats, 'is_voting') as unknown as Seat[],
    roles: roles as unknown as Role[],
    questions: flag(questions, 'is_hot') as unknown as Question[],
    questionBodies: questionBodies as unknown as QuestionBody[],
    questionDeciders: [],
    offices: [],
    officeHolders: [],
    questionOffices: [],
    stances: [],
    sources: sources as unknown as Source[],
    acts: acts as unknown as Act[],
    reports: reports as unknown as Report[],
    readings: readings as unknown as Reading[],
  }
}

// GET /feed.xml, with the same `question` and `body` filters as /latest.
export async function atomResponse(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const questionSlug = url.searchParams.get('question') || undefined
  const bodySlug = url.searchParams.get('body') || undefined
  const tracker = buildTracker(await loadRecord(env.DB), new Date().toISOString().slice(0, 10))
  const question = questionSlug ? tracker.questionBySlug.get(questionSlug) : undefined
  const body = bodySlug ? tracker.bodies.find((b) => b.slug === bodySlug) : undefined
  if ((questionSlug && !question) || (bodySlug && !body)) return new Response('No such question or body.', { status: 404 })

  const entries = buildFeed(tracker, { questionId: question?.id, bodyId: body?.id }).slice(0, FEED_PAGE)
  const query = url.searchParams.toString()
  const filtered = [question?.short_title, body?.name].filter(Boolean).join(', ')
  const xml = atomFeed(entries, {
    origin: url.origin,
    title: `Sporelight: latest on the record${filtered ? ` (${filtered})` : ''}`,
    self: `/feed.xml${query ? `?${query}` : ''}`,
    page: `/latest${query ? `?${query}` : ''}`,
  })
  return new Response(xml, { headers: { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } })
}
