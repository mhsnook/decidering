import type { Act, Decider, Proposal, ProposalItem, Question, Reading, Report, Source } from '../../shared/schema.ts'
import type { Tracker } from './build-tracker.ts'

// One published act, with every question it is read on.
export type FeedEntry = {
  act: Act
  decider: Decider
  // When the act entered the record: the time it was published.
  enteredAt: string
  readings: { reading: Reading; question: Question; via: Question | undefined }[]
  reports: { report: Report; source: Source }[]
  isDemo: boolean
}

// One act a proposal claims, with the readings it claims for it. Nobody has
// checked it.
export type WaitingEntry = {
  key: string
  proposal: Proposal
  source: Source | undefined
  decider: Decider
  kind: ProposalItem['kind']
  occurred_on: string | null
  quote: string
  claims: { item: ProposalItem; question: Question; reading: NonNullable<ProposalItem['reading']> }[]
  isDemo: boolean
}

// `question` keeps entries read on that question or anything under it. `body`
// keeps entries by someone with a seat in that body, read on a question put to it.
export type FeedFilter = { questionId?: string; bodyId?: string }

export const FEED_PAGE = 50

// A question and every question under it, at any depth.
export function questionFamily(tracker: Pick<Tracker, 'questions'>, questionId: string): Set<string> {
  const family = new Set([questionId])
  let grew = true
  while (grew) {
    grew = false
    for (const q of tracker.questions) {
      if (q.parent_id && family.has(q.parent_id) && !family.has(q.id)) {
        family.add(q.id)
        grew = true
      }
    }
  }
  return family
}

function matcher(tracker: Tracker, filter: FeedFilter) {
  const family = filter.questionId ? questionFamily(tracker, filter.questionId) : null
  const seated = filter.bodyId
    ? new Set(tracker.roles.filter((r) => tracker.seatById.get(r.seat_id)?.body_id === filter.bodyId).map((r) => r.decider_id))
    : null
  return {
    person: (deciderId: string) => !seated || seated.has(deciderId),
    question: (question: Question) => (!family || family.has(question.id)) && (!filter.bodyId || tracker.appliesIn(question, filter.bodyId)),
  }
}

const isDemoQuestion = (tracker: Tracker, question: Question) => tracker.bodyById.get(question.body_id)?.is_demo === true

// The published record as a feed, newest first. One act read on several
// questions is one entry.
export function buildFeed(tracker: Tracker, filter: FeedFilter = {}): FeedEntry[] {
  const match = matcher(tracker, filter)
  const readingsByAct = new Map<string, Reading[]>()
  for (const r of tracker.readings) {
    const list = readingsByAct.get(r.act_id)
    if (list) list.push(r)
    else readingsByAct.set(r.act_id, [r])
  }
  const reportsByAct = new Map<string, Report[]>()
  for (const r of tracker.reports) {
    const list = reportsByAct.get(r.act_id)
    if (list) list.push(r)
    else reportsByAct.set(r.act_id, [r])
  }

  const entries: FeedEntry[] = []
  for (const act of tracker.acts) {
    const decider = tracker.deciderById.get(act.decider_id)
    if (!decider || !match.person(decider.id)) continue
    const readings = (readingsByAct.get(act.id) ?? [])
      .flatMap((reading) => {
        const question = tracker.questionById.get(reading.question_id)
        if (!question) return []
        const via = reading.via_question_id ? tracker.questionById.get(reading.via_question_id) : undefined
        return [{ reading, question, via }]
      })
      // The question read directly before any it was written on by implication.
      .sort((a, b) => Number(a.via !== undefined) - Number(b.via !== undefined) || a.question.sort - b.question.sort)
    if (readings.length === 0 || !readings.some((r) => match.question(r.question))) continue
    const reports = (reportsByAct.get(act.id) ?? [])
      .flatMap((report) => {
        const source = tracker.sourceById.get(report.source_id)
        return source ? [{ report, source }] : []
      })
      .sort((a, b) => Number(b.source.id === act.primary_source_id) - Number(a.source.id === act.primary_source_id) || a.report.created_at.localeCompare(b.report.created_at))
    entries.push({ act, decider, enteredAt: act.created_at, readings, reports, isDemo: readings.some((r) => isDemoQuestion(tracker, r.question)) })
  }
  return entries.sort(
    (a, b) => b.enteredAt.localeCompare(a.enteredAt) || b.act.occurred_on.localeCompare(a.act.occurred_on) || a.act.id.localeCompare(b.act.id),
  )
}

// What is waiting for review that claims something: pending items with a
// reading. Rejected items, and search leads that only name someone, are left
// out. Items of one proposal that share an act are one entry.
export function buildWaiting(tracker: Tracker, proposals: Proposal[], items: ProposalItem[], filter: FeedFilter = {}): WaitingEntry[] {
  const match = matcher(tracker, filter)
  const proposalById = new Map(proposals.map((p) => [p.id, p]))
  const byKey = new Map<string, WaitingEntry>()
  for (const item of [...items].sort((a, b) => a.sort - b.sort)) {
    if (item.status !== 'pending' || item.reading === null) continue
    const proposal = proposalById.get(item.proposal_id)
    const decider = tracker.deciderById.get(item.decider_id)
    const question = tracker.questionById.get(item.question_id)
    if (!proposal || proposal.status !== 'pending' || !decider || !question || !match.person(decider.id) || !match.question(question)) continue
    const key = `${proposal.id}:${item.act_id}`
    const claim = { item, question, reading: item.reading }
    const entry = byKey.get(key)
    if (entry) {
      entry.claims.push(claim)
      entry.isDemo ||= isDemoQuestion(tracker, question)
      continue
    }
    byKey.set(key, {
      key,
      proposal,
      source: tracker.sourceById.get(proposal.source_id),
      decider,
      kind: item.kind,
      occurred_on: item.occurred_on,
      quote: item.quote,
      claims: [claim],
      isDemo: isDemoQuestion(tracker, question),
    })
  }
  return [...byKey.values()].sort((a, b) => b.proposal.created_at.localeCompare(a.proposal.created_at) || a.key.localeCompare(b.key))
}

// One page of the feed: the entries after `before` (an act id), or the newest
// if it is missing or no longer in the feed. `older` is the cursor for the next
// page, if there is one.
export function feedPage(entries: FeedEntry[], before: string | undefined, size = FEED_PAGE): { entries: FeedEntry[]; older: string | undefined; isFirst: boolean } {
  const at = before ? entries.findIndex((e) => e.act.id === before) : -1
  const start = at + 1
  const page = entries.slice(start, start + size)
  return { entries: page, older: start + size < entries.length ? page[page.length - 1].act.id : undefined, isFirst: start === 0 }
}

// Consecutive entries that entered the record on the same UTC day.
export function byDay<T>(entries: T[], at: (entry: T) => string): { day: string; entries: T[] }[] {
  const days: { day: string; entries: T[] }[] = []
  for (const entry of entries) {
    const day = at(entry).slice(0, 10)
    const last = days[days.length - 1]
    if (last?.day === day) last.entries.push(entry)
    else days.push({ day, entries: [entry] })
  }
  return days
}

// The Atom feed of the same selection. It carries published entries only.
export function atomHref(filter: { question?: string; body?: string }) {
  const params = new URLSearchParams()
  if (filter.question) params.set('question', filter.question)
  if (filter.body) params.set('body', filter.body)
  const query = params.toString()
  return `/feed.xml${query ? `?${query}` : ''}`
}
