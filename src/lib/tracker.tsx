import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { Body, Decider, Evidence, Question, Role, Seat, Stance } from '../../shared/schema.ts'
import { stanceId } from '../../shared/schema.ts'
import { footingOf, type Footing } from '../../shared/standing.ts'
import { db } from './db.ts'
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

export type Contender = {
  decider: Decider
  role: Role
  stance: Stance | undefined
  standing: Standing
  evidence: Evidence[]
  footing: Footing
}

export type SeatRow = {
  seat: Seat
  incumbent: Contender | undefined
  challengers: Contender[]
}

export type HeldSeat = SeatRow & { incumbent: Contender }
export const isHeld = (row: SeatRow): row is HeldSeat => row.incumbent !== undefined

function buildTracker(c: {
  bodies: Body[]
  deciders: Decider[]
  seats: Seat[]
  roles: Role[]
  questions: Question[]
  stances: Stance[]
  evidence: Evidence[]
}) {
  const deciderById = indexBy(c.deciders, (d) => d.id)
  const deciderBySlug = indexBy(c.deciders, (d) => d.slug)
  const questionById = indexBy(c.questions, (q) => q.id)
  const questionBySlug = indexBy(c.questions, (q) => q.slug)
  const seatById = indexBy(c.seats, (s) => s.id)
  const stanceById = indexBy(c.stances, (s) => s.id)
  const seatsByBody = groupBy(c.seats, (s) => s.body_id)
  const rolesBySeat = groupBy(c.roles, (r) => r.seat_id)
  const rolesByDecider = groupBy(c.roles, (r) => r.decider_id)
  const childrenOf = groupBy(
    c.questions.filter((q) => q.parent_id),
    (q) => q.parent_id!,
  )
  for (const list of childrenOf.values()) list.sort((a, b) => a.sort - b.sort)
  const evidenceByPair = groupBy(c.evidence, (e) => stanceId(e.question_id, e.decider_id))

  // A question's evidence includes its sub-questions': cosponsoring the bill is
  // also evidence on the broader question it belongs to.
  function evidenceFor(question: Question, deciderId: string): Evidence[] {
    const ids = [question.id, ...(childrenOf.get(question.id) ?? []).map((q) => q.id)]
    return ids
      .flatMap((id) => evidenceByPair.get(stanceId(id, deciderId)) ?? [])
      .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
  }

  function contender(question: Question, role: Role): Contender | undefined {
    const decider = deciderById.get(role.decider_id)
    if (!decider) return undefined
    const stance = stanceById.get(stanceId(question.id, decider.id))
    const evidence = evidenceFor(question, decider.id)
    return { decider, role, stance, standing: stance?.position ?? 'unknown', evidence, footing: footingOf(evidence) }
  }

  function board(question: Question): SeatRow[] {
    const seats = (seatsByBody.get(question.body_id) ?? []).filter((s) => !question.chamber || s.chamber === question.chamber)
    return seats.map((seat) => {
      const contenders = (rolesBySeat.get(seat.id) ?? []).map((r) => contender(question, r)).filter((x) => x !== undefined)
      return {
        seat,
        incumbent: contenders.find((x) => x.role.kind === 'incumbent'),
        challengers: contenders.filter((x) => x.role.kind === 'challenger'),
      }
    })
  }

  return {
    ...c,
    deciderById,
    deciderBySlug,
    questionById,
    questionBySlug,
    seatById,
    stanceById,
    rolesBySeat,
    rolesByDecider,
    childrenOf,
    evidenceFor,
    contender,
    board,
  }
}

export type Tracker = ReturnType<typeof buildTracker>

const TrackerContext = createContext<{ tracker: Tracker; isReady: boolean } | null>(null)

// Every public collection is synced whole and joined here in memory, so every
// page reads from the same local copy and updates the moment a row changes.
export function TrackerProvider({ children }: { children: ReactNode }) {
  const bodies = useLiveQuery((q) => q.from({ row: db.bodies }))
  const deciders = useLiveQuery((q) => q.from({ row: db.deciders }))
  const seats = useLiveQuery((q) => q.from({ row: db.seats }))
  const roles = useLiveQuery((q) => q.from({ row: db.roles }))
  const questions = useLiveQuery((q) => q.from({ row: db.questions }))
  const stances = useLiveQuery((q) => q.from({ row: db.stances }))
  const evidence = useLiveQuery((q) => q.from({ row: db.evidence }))

  const tracker = useMemo(
    () =>
      buildTracker({
        bodies: bodies.data,
        deciders: deciders.data,
        seats: seats.data,
        roles: roles.data,
        questions: questions.data,
        stances: stances.data,
        evidence: evidence.data,
      }),
    [bodies.data, deciders.data, seats.data, roles.data, questions.data, stances.data, evidence.data],
  )
  const isReady = [bodies, deciders, seats, roles, questions, stances, evidence].every((q) => q.isReady)

  return <TrackerContext value={{ tracker, isReady }}>{children}</TrackerContext>
}

export function useTracker() {
  const ctx = useContext(TrackerContext)
  if (!ctx) throw new Error('useTracker must be used inside TrackerProvider')
  return ctx
}
