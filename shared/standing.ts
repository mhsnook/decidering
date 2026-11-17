

const DAY = 86_400_000
export const FRESH_DAYS = 180
export const STALE_DAYS = 730

export type Footing = 'unknown' | 'on_record' | 'fresh' | 'established' | 'sparse' | 'stale'

export const FOOTING_LABEL: Record<Footing, string> = {
  unknown: 'No evidence',
  on_record: 'On the record',
  fresh: 'Fresh',
  established: 'Established',
  sparse: 'Sparse',
  stale: 'Stale',
}

export const FOOTING_HINT: Record<Footing, string> = {
  unknown: 'Nothing on file yet.',
  on_record: 'Backed by a vote, or by a commitment such as a cosponsorship that still stands.',
  fresh: `The most recent item is under ${FRESH_DAYS} days old.`,
  established: 'Several items, none of them recent.',
  sparse: 'Rests on a single item.',
  stale: `Nothing newer than ${Math.round(STALE_DAYS / 365)} years.`,
}

// One entry on someone's record, as footing sees it. `onRecord` is true for an
// act that binds them on this very question and still holds: a use of office,
// or a commitment in force, read directly. One of those is enough and never
// goes stale. Everything else is a dated signal.
export type Signal = { occurred_on: string; onRecord: boolean }

export function footingOf(signals: Signal[], now: Date = new Date()): Footing {
  if (!signals.length) return 'unknown'
  if (signals.some((s) => s.onRecord)) return 'on_record'
  const newest = Math.max(...signals.map((s) => Date.parse(s.occurred_on)))
  const ageDays = (now.getTime() - newest) / DAY
  if (ageDays > STALE_DAYS) return 'stale'
  if (signals.length === 1) return 'sparse'
  if (ageDays <= FRESH_DAYS) return 'fresh'
  return 'established'
}

// Footings that tell a reader "this could use another look".
export const NEEDS_ATTENTION: ReadonlySet<Footing> = new Set(['unknown', 'sparse', 'stale'])
