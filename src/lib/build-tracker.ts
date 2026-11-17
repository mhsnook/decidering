import type { Act, Body, Decider, Question, QuestionDecider, Reading, Report, Role, Seat, Source, Stance } from '../../shared/schema.ts'
import { stanceId } from '../../shared/schema.ts'
import { footingOf, type Footing } from '../../shared/standing.ts'
import type { Standing } from './position.ts'

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

const indexBy = <T, K>(items: readonly T[], key: (item: T) => K) => new Map(items.map((i) => [key(i), i] as const))

// One act as it bears on one question: what it signals there, and every source
// that reports it.
export type RecordEntry = {
  act: Act
  reading: Reading
  // The sub-question this reading was written from, when support there counts here.
  via: Question | undefined
  reports: { report: Report; source: Source }[]
}

export type Contender = {
  decider: Decider
  role: Role
  stance: Stance | undefined
  standing: Standing
  record: RecordEntry[]
  footing: Footing
}

export type SeatRow = {
  seat: Seat
  incumbent: Contender | undefined
  challengers: Contender[]
}

export type HeldSeat = SeatRow & { incumbent: Contender }
export const isHeld = (row: SeatRow): row is HeldSeat => row.incumbent !== undefined

// An ask and one of the people it is put to.
export type KeyPerson = { ask: Question; link: QuestionDecider; contender: Contender; seat: Seat }

export type TrackerData = {
  bodies: Body[]
  deciders: Decider[]
  seats: Seat[]
  roles: Role[]
  questions: Question[]
  questionDeciders: QuestionDecider[]
  stances: Stance[]
  sources: Source[]
  acts: Act[]
  reports: Report[]
  readings: Reading[]
}

export function buildTracker(c: TrackerData) {
  const deciderById = indexBy(c.deciders, (d) => d.id)
  const deciderBySlug = indexBy(c.deciders, (d) => d.slug)
  const questionById = indexBy(c.questions, (q) => q.id)
  const questionBySlug = indexBy(c.questions, (q) => q.slug)
  const seatById = indexBy(c.seats, (s) => s.id)
  const stanceById = indexBy(c.stances, (s) => s.id)
  const sourceById = indexBy(c.sources, (s) => s.id)
  const actById = indexBy(c.acts, (a) => a.id)
  const seatsByBody = groupBy(c.seats, (s) => s.body_id)
  const rolesBySeat = groupBy(c.roles, (r) => r.seat_id)
  const rolesByDecider = groupBy(c.roles, (r) => r.decider_id)
  const actsByDecider = groupBy(c.acts, (a) => a.decider_id)
  const reportsByAct = groupBy(c.reports, (r) => r.act_id)
  const namedIn = groupBy(c.questionDeciders, (l) => l.question_id)

  const isAsk = (question: Question) => namedIn.has(question.id)
  const byOpenThenSort = (a: Question, b: Question) => Number(a.status !== 'open') - Number(b.status !== 'open') || a.sort - b.sort
  const children = c.questions.filter((q) => q.parent_id)
  // Sub-questions put to the whole body or chamber, and those put to named people.
  const measuresOf = groupBy(
    children.filter((q) => !isAsk(q)).sort((a, b) => a.sort - b.sort),
    (q) => q.parent_id!,
  )
  const asksOf = groupBy(
    children.filter(isAsk).sort(byOpenThenSort),
    (q) => q.parent_id!,
  )

  const entriesByPair = new Map<string, RecordEntry[]>()
  for (const reading of c.readings) {
    const act = actById.get(reading.act_id)
    if (!act) continue
    const reports = (reportsByAct.get(act.id) ?? [])
      .map((report) => ({ report, source: sourceById.get(report.source_id) }))
      .filter((r): r is { report: Report; source: Source } => r.source !== undefined)
      // The record of the act itself before the sources that only report it.
      .sort((a, b) => Number(b.source.id === act.primary_source_id) - Number(a.source.id === act.primary_source_id) || a.report.created_at.localeCompare(b.report.created_at))
    const entry = { act, reading, via: reading.via_question_id ? questionById.get(reading.via_question_id) : undefined, reports }
    const key = stanceId(reading.question_id, act.decider_id)
    const list = entriesByPair.get(key)
    if (list) list.push(entry)
    else entriesByPair.set(key, [entry])
  }
  for (const list of entriesByPair.values()) list.sort((a, b) => b.act.occurred_on.localeCompare(a.act.occurred_on) || a.act.id.localeCompare(b.act.id))

  // A decider's record on a question is the readings on that question alone. A
  // reading on a sub-question appears here only if it was also written here.
  const recordFor = (question: Question, deciderId: string): RecordEntry[] => entriesByPair.get(stanceId(question.id, deciderId)) ?? []

  function contender(question: Question, role: Role): Contender | undefined {
    const decider = deciderById.get(role.decider_id)
    if (!decider) return undefined
    const stance = stanceById.get(stanceId(question.id, decider.id))
    const record = recordFor(question, decider.id)
    return { decider, role, stance, standing: stance?.position ?? 'unknown', record, footing: footingOf(record.map((e) => e.act)) }
  }

  const appliesTo = (question: Question, deciderId: string) => {
    const named = namedIn.get(question.id)
    return !named || named.some((l) => l.decider_id === deciderId)
  }

  function board(question: Question): SeatRow[] {
    const seats = (seatsByBody.get(question.body_id) ?? []).filter((s) => !question.chamber || s.chamber === question.chamber)
    return seats
      .map((seat) => {
        const contenders = (rolesBySeat.get(seat.id) ?? [])
          .filter((r) => appliesTo(question, r.decider_id))
          .map((r) => contender(question, r))
          .filter((x) => x !== undefined)
        return {
          seat,
          incumbent: contenders.find((x) => x.role.kind === 'incumbent'),
          challengers: contenders.filter((x) => x.role.kind === 'challenger'),
        }
      })
      .filter((row) => !isAsk(question) || row.incumbent || row.challengers.length > 0)
  }

  function roleIn(question: Question, deciderId: string): Role | undefined {
    return (rolesByDecider.get(deciderId) ?? []).find((r) => seatById.get(r.seat_id)?.body_id === question.body_id)
  }

  // The people an ask is put to, in the order they were added.
  function peopleOf(ask: Question): KeyPerson[] {
    return (namedIn.get(ask.id) ?? []).flatMap((link) => {
      const role = roleIn(ask, link.decider_id)
      const seat = role && seatById.get(role.seat_id)
      const person = role && contender(ask, role)
      return person && seat ? [{ ask, link, contender: person, seat }] : []
    })
  }

  // Everyone with an ask under this question, open asks first.
  const keyPeople = (question: Question): KeyPerson[] => (asksOf.get(question.id) ?? []).flatMap(peopleOf)

  const asksFor = (question: Question, deciderId: string): KeyPerson[] => keyPeople(question).filter((k) => k.contender.decider.id === deciderId)

  return {
    ...c,
    deciderById,
    deciderBySlug,
    questionById,
    questionBySlug,
    seatById,
    stanceById,
    sourceById,
    actById,
    actsByDecider,
    rolesBySeat,
    rolesByDecider,
    measuresOf,
    asksOf,
    isAsk,
    appliesTo,
    recordFor,
    contender,
    board,
    roleIn,
    peopleOf,
    keyPeople,
    asksFor,
  }
}

export type Tracker = ReturnType<typeof buildTracker>
