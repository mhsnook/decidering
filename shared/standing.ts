import type { Act, ActKind } from './schema.ts'

const DAY = 86_400_000
export const FRESH_DAYS = 180
export const STALE_DAYS = 730

// A recorded act stays true until it is withdrawn, so it never goes stale and
// one of them is enough.
const STANDING_KINDS: ReadonlySet<ActKind> = new Set(['formal_act', 'vote'])

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
  on_record: 'Backed by a recorded act such as a cosponsorship or a vote.',
  fresh: `Most recent statement is under ${FRESH_DAYS} days old.`,
  established: 'Several statements, none of them recent.',
  sparse: 'Rests on a single statement.',
  stale: `Nothing newer than ${Math.round(STALE_DAYS / 365)} years.`,
}

export const isRecordedAct = (kind: ActKind) => STANDING_KINDS.has(kind)

export function footingOf(acts: Pick<Act, 'kind' | 'occurred_on'>[], now: Date = new Date()): Footing {
  if (!acts.length) return 'unknown'
  if (acts.some((a) => STANDING_KINDS.has(a.kind))) return 'on_record'
  const newest = Math.max(...acts.map((a) => Date.parse(a.occurred_on)))
  const ageDays = (now.getTime() - newest) / DAY
  if (ageDays > STALE_DAYS) return 'stale'
  if (acts.length === 1) return 'sparse'
  if (ageDays <= FRESH_DAYS) return 'fresh'
  return 'established'
}

// Footings that tell a reader "this could use another look".
export const NEEDS_ATTENTION: ReadonlySet<Footing> = new Set(['unknown', 'sparse', 'stale'])
