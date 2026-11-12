import type { ReactNode } from 'react'
import type { Question } from '../../shared/schema.ts'
import { FOOTING_HINT, FOOTING_LABEL, type Footing } from '../../shared/standing.ts'
import { STANDINGS, STANDING_BG, standingLabel, type Standing } from '../lib/position.ts'

export function StandingPill({ standing, question }: { standing: Standing; question: Pick<Question, 'kind'> }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pr-2.5 pl-1.5 text-xs font-medium whitespace-nowrap">
      <span className={`size-2.5 rounded-full ${STANDING_BG[standing]}`} />
      {standingLabel(standing, question)}
    </span>
  )
}

const FOOTING_STYLE: Record<Footing, string> = {
  unknown: 'border-dashed text-muted',
  on_record: 'border-ink/40 text-ink',
  fresh: 'border-support/60 text-support',
  established: 'border-line text-muted',
  sparse: 'border-dashed border-accent/70 text-accent',
  stale: 'border-dotted border-muted text-muted italic',
}

export function FootingTag({ footing }: { footing: Footing }) {
  return (
    <span title={FOOTING_HINT[footing]} className={`rounded border px-1.5 py-px text-[11px] font-medium whitespace-nowrap ${FOOTING_STYLE[footing]}`}>
      {FOOTING_LABEL[footing]}
    </span>
  )
}

export function TallyBar({ counts, question }: { counts: Record<Standing, number>; question: Pick<Question, 'kind'> }) {
  const total = STANDINGS.reduce((n, s) => n + counts[s], 0)
  const shown = STANDINGS.filter((s) => counts[s] > 0)
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={shown.map((s) => `${standingLabel(s, question)}: ${counts[s]}`).join(', ')}>
        {shown.map((s) => (
          <div key={s} className={`${STANDING_BG[s]} border-r border-paper last:border-r-0`} style={{ width: `${(counts[s] / total) * 100}%` }} />
        ))}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shown.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${STANDING_BG[s]}`} />
            <dt className="text-muted">{standingLabel(s, question)}</dt>
            <dd className="font-semibold tabular-nums">{counts[s]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function tally(standings: Standing[]): Record<Standing, number> {
  const counts = { support: 0, lean_support: 0, mixed: 0, lean_oppose: 0, oppose: 0, unknown: 0 }
  for (const s of standings) counts[s]++
  return counts
}

export function Syncing() {
  return <p className="animate-pulse py-16 text-center text-muted">Syncing the record…</p>
}

export function NotFound({ what }: { what: string }) {
  return <p className="py-16 text-center text-muted">No {what} here.</p>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold tracking-widest text-accent uppercase">{children}</p>
}
