import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { db } from './db.ts'
import { buildTracker, type Tracker } from './build-tracker.ts'

export { isHeld, type Contender, type HeldSeat, type KeyPerson, type RecordEntry, type SeatRow, type Tracker } from './build-tracker.ts'

const TrackerContext = createContext<{ tracker: Tracker; isReady: boolean } | null>(null)

// Every public collection is synced whole and joined here in memory, so every
// page reads from the same local copy and updates the moment a row changes.
export function TrackerProvider({ children }: { children: ReactNode }) {
  const bodies = useLiveQuery((q) => q.from({ row: db.bodies }))
  const deciders = useLiveQuery((q) => q.from({ row: db.deciders }))
  const seats = useLiveQuery((q) => q.from({ row: db.seats }))
  const roles = useLiveQuery((q) => q.from({ row: db.roles }))
  const questions = useLiveQuery((q) => q.from({ row: db.questions }))
  const questionDeciders = useLiveQuery((q) => q.from({ row: db.question_deciders }))
  const stances = useLiveQuery((q) => q.from({ row: db.stances }))
  const sources = useLiveQuery((q) => q.from({ row: db.sources }))
  const acts = useLiveQuery((q) => q.from({ row: db.acts }))
  const reports = useLiveQuery((q) => q.from({ row: db.reports }))
  const readings = useLiveQuery((q) => q.from({ row: db.readings }))

  const tracker = useMemo(
    () =>
      buildTracker({
        bodies: bodies.data,
        deciders: deciders.data,
        seats: seats.data,
        roles: roles.data,
        questions: questions.data,
        questionDeciders: questionDeciders.data,
        stances: stances.data,
        sources: sources.data,
        acts: acts.data,
        reports: reports.data,
        readings: readings.data,
      }),
    [bodies.data, deciders.data, seats.data, roles.data, questions.data, questionDeciders.data, stances.data, sources.data, acts.data, reports.data, readings.data],
  )
  const isReady = [bodies, deciders, seats, roles, questions, questionDeciders, stances, sources, acts, reports, readings].every((q) => q.isReady)

  return <TrackerContext value={{ tracker, isReady }}>{children}</TrackerContext>
}

export function useTracker() {
  const ctx = useContext(TrackerContext)
  if (!ctx) throw new Error('useTracker must be used inside TrackerProvider')
  return ctx
}
