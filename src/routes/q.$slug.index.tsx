import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { Question } from '../../shared/schema.ts'
import { NEEDS_ATTENTION } from '../../shared/standing.ts'
import { useTracker, type SeatRow } from '../lib/tracker.tsx'
import { STANDINGS, STANDING_BG, standingLabel, type Standing } from '../lib/position.ts'
import { FootingTag, NotFound, Syncing, TallyBar, tally } from '../components/bits.tsx'
import { QuestionHeader } from '../components/QuestionHeader.tsx'

type BoardSearch = { q?: string; chamber?: string; standing?: Standing; thin?: boolean; contested?: boolean }

export const Route = createFileRoute('/q/$slug/')({
  component: Board,
  validateSearch: (s: Record<string, unknown>): BoardSearch => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    chamber: typeof s.chamber === 'string' && s.chamber ? s.chamber : undefined,
    standing: STANDINGS.includes(s.standing as Standing) ? (s.standing as Standing) : undefined,
    thin: s.thin === true || undefined,
    contested: s.contested === true || undefined,
  }),
})

function Board() {
  const { slug } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { tracker, isReady } = useTracker()
  const question = tracker.questionBySlug.get(slug)
  const rows = useMemo(() => (question ? tracker.board(question).filter((r) => r.incumbent) : []), [tracker, question])

  if (!isReady) return <Syncing />
  if (!question) return <NotFound what="question" />

  const set = (patch: BoardSearch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const chambers = [...new Set(rows.map((r) => r.seat.chamber).filter((c) => c !== null))].sort()
  const hasChallengers = rows.some((r) => r.challengers.length > 0)
  const needle = search.q?.toLowerCase()

  const visible = rows.filter((r) => {
    const inc = r.incumbent!
    if (search.chamber && r.seat.chamber !== search.chamber) return false
    if (search.standing && inc.standing !== search.standing) return false
    if (search.thin && !NEEDS_ATTENTION.has(inc.footing)) return false
    if (search.contested && !r.challengers.some((c) => c.stance)) return false
    if (needle) {
      const haystack = [inc.decider.name, r.seat.label, inc.role.affiliation, ...r.challengers.map((c) => c.decider.name)].join(' ').toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })

  const scoped = search.chamber ? rows.filter((r) => r.seat.chamber === search.chamber) : rows
  const groups = STANDINGS.map((standing) => ({
    standing,
    rows: visible
      .filter((r) => r.incumbent!.standing === standing)
      .sort((a, b) => a.incumbent!.decider.sort_name.localeCompare(b.incumbent!.decider.sort_name)),
  })).filter((g) => g.rows.length > 0)

  return (
    <div className="space-y-8">
      <QuestionHeader question={question} />
      <TallyBar counts={tally(scoped.map((r) => r.incumbent!.standing))} question={question} />

      <div className="flex flex-wrap items-center gap-2 border-y border-line py-3">
        <input
          type="search"
          className="field max-w-56"
          placeholder="Search name, seat, party"
          aria-label="Search"
          value={search.q ?? ''}
          onChange={(e) => set({ q: e.target.value || undefined })}
        />
        {chambers.length > 1 && (
          <select className="field w-auto" aria-label="Chamber" value={search.chamber ?? ''} onChange={(e) => set({ chamber: e.target.value || undefined })}>
            <option value="">All chambers</option>
            {chambers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <select
          className="field w-auto"
          aria-label="Position"
          value={search.standing ?? ''}
          onChange={(e) => set({ standing: (e.target.value || undefined) as Standing | undefined })}
        >
          <option value="">Any position</option>
          {STANDINGS.map((s) => (
            <option key={s} value={s}>
              {standingLabel(s, question)}
            </option>
          ))}
        </select>
        <Toggle on={!!search.thin} onChange={(thin) => set({ thin: thin || undefined })}>
          Thin evidence
        </Toggle>
        {hasChallengers && (
          <Toggle on={!!search.contested} onChange={(contested) => set({ contested: contested || undefined })}>
            Challenger on record
          </Toggle>
        )}
        <span className="ml-auto text-sm text-muted tabular-nums">
          {visible.length} of {rows.length}
        </span>
      </div>

      {groups.length === 0 && <p className="py-8 text-center text-muted">Nobody matches those filters.</p>}
      {groups.map((group) => (
        <section key={group.standing}>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <span className={`size-3 rounded-full ${STANDING_BG[group.standing]}`} />
            {standingLabel(group.standing, question)}
            <span className="font-sans text-sm font-normal text-muted tabular-nums">{group.rows.length}</span>
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.rows.map((row) => (
              <SeatCard key={row.seat.id} row={row} question={question} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={`btn ${on ? 'btn-primary' : ''}`}>
      {children}
    </button>
  )
}

function SeatCard({ row, question }: { row: SeatRow; question: Question }) {
  const inc = row.incumbent!
  return (
    <li className="relative overflow-hidden rounded-lg border border-line bg-surface">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${STANDING_BG[inc.standing]}`} />
      <Link to="/q/$slug/$decider" params={{ slug: question.slug, decider: inc.decider.slug }} className="block py-2 pr-3 pl-4 hover:bg-paper">
        <span className="flex items-start justify-between gap-2">
          <span className="leading-snug font-medium">{inc.decider.name}</span>
          {inc.footing !== 'unknown' && <FootingTag footing={inc.footing} />}
        </span>
        <span className="block text-xs text-muted">
          {row.seat.label}
          {inc.role.affiliation && ` · ${inc.role.affiliation}`}
          {!row.seat.is_voting && ' · non-voting'}
        </span>
      </Link>
      {row.challengers.length > 0 && (
        <ul className="border-t border-line py-1.5 pr-3 pl-4 text-xs">
          {row.challengers.map((c) => (
            <li key={c.decider.id}>
              <Link to="/q/$slug/$decider" params={{ slug: question.slug, decider: c.decider.slug }} className="flex items-center gap-1.5 py-0.5 hover:underline">
                <span className={`size-2 shrink-0 rounded-full ${STANDING_BG[c.standing]}`} />
                <span className="truncate">
                  <span className="text-muted">{c.role.contest ?? 'challenger'}:</span> {c.decider.name}
                </span>
                <span className="ml-auto whitespace-nowrap text-muted">{standingLabel(c.standing, question)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
