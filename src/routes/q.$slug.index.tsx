import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { Question } from '../../shared/schema.ts'
import { NEEDS_ATTENTION } from '../../shared/standing.ts'
import { isHeld, useTracker, type HeldSeat } from '../lib/tracker.tsx'
import { SPECTRUM, STANDINGS, STANDING_BG, standingLabel, type Standing } from '../lib/position.ts'
import { FootingTag, NotFound, StandingDot, Syncing, tally } from '../components/bits.tsx'
import { Hemicycle } from '../components/Hemicycle.tsx'
import { QuestionHeader } from '../components/QuestionHeader.tsx'

// How many of a group to list before a reader has to ask for the rest.
const PREVIEW = 12

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
  const rows = useMemo(() => (question ? tracker.board(question).filter(isHeld) : []), [tracker, question])

  if (!isReady) return <Syncing />
  if (!question) return <NotFound what="question" />

  const set = (patch: BoardSearch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const body = tracker.bodies.find((b) => b.id === question.body_id)
  const chambers = [...new Set(rows.map((r) => r.seat.chamber).filter((c) => c !== null))].sort()
  const chamber = chambers.includes(search.chamber ?? '') ? search.chamber : undefined
  const hasChallengers = rows.some((r) => r.challengers.length > 0)
  const needle = search.q?.toLowerCase()

  // Everything but the chamber, which decides which charts are drawn rather
  // than which seats in them are lit.
  const matches = (r: HeldSeat) => {
    const inc = r.incumbent
    if (search.standing && inc.standing !== search.standing) return false
    if (search.thin && !NEEDS_ATTENTION.has(inc.footing)) return false
    if (search.contested && !r.challengers.some((c) => c.stance)) return false
    if (needle) {
      const haystack = [inc.decider.name, r.seat.label, inc.role.affiliation, ...r.challengers.map((c) => c.decider.name)].join(' ').toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  }

  const scoped = chamber ? rows.filter((r) => r.seat.chamber === chamber) : rows
  const visible = scoped.filter(matches)
  const counts = tally(scoped.map((r) => r.incumbent.standing))
  const charts = chambers.length > 0 ? chambers.filter((c) => !chamber || c === chamber) : [null]
  const groups = STANDINGS.map((standing) => ({
    standing,
    rows: visible.filter((r) => r.incumbent.standing === standing).sort((a, b) => a.incumbent.decider.sort_name.localeCompare(b.incumbent.decider.sort_name)),
  })).filter((g) => g.rows.length > 0)

  return (
    <div className="space-y-6">
      <QuestionHeader question={question} />

      <div className={`grid gap-4 ${charts.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {charts.map((c) => (
          <Hemicycle
            key={c ?? 'all'}
            title={c ?? body?.name ?? 'Seats'}
            rows={c ? rows.filter((r) => r.seat.chamber === c) : rows}
            question={question}
            isLit={matches}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {SPECTRUM.filter((s) => counts[s] > 0).map((s) => {
          const on = search.standing === s
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => set({ standing: on ? undefined : s })}
              className={`min-w-32 flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${on ? 'border-ink bg-surface' : 'border-line hover:border-ink'}`}
            >
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <StandingDot standing={s} />
                {standingLabel(s, question)}
              </span>
              <span className="mt-1 block font-display text-3xl leading-none font-semibold tabular-nums">{counts[s]}</span>
            </button>
          )
        })}
      </div>

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
          <div className="flex" role="group" aria-label="Chamber">
            {[undefined, ...chambers].map((c) => (
              <button
                key={c ?? 'all'}
                type="button"
                aria-pressed={chamber === c}
                onClick={() => set({ chamber: c })}
                className={`btn -ml-px rounded-none first:ml-0 first:rounded-l-md last:rounded-r-md ${chamber === c ? 'btn-primary relative' : ''}`}
              >
                {c ?? 'Both'}
              </button>
            ))}
          </div>
        )}
        <Toggle on={!!search.thin} onChange={(thin) => set({ thin: thin || undefined })}>
          Thin evidence
        </Toggle>
        {hasChallengers && (
          <Toggle on={!!search.contested} onChange={(contested) => set({ contested: contested || undefined })}>
            Challenger on record
          </Toggle>
        )}
        <span className="ml-auto text-sm text-muted tabular-nums">
          {visible.length} of {scoped.length}
        </span>
      </div>

      {groups.length === 0 && <p className="py-8 text-center text-muted">Nobody matches those filters.</p>}
      {groups.map((group) => {
        const shown = search.standing || needle ? group.rows : group.rows.slice(0, PREVIEW)
        return (
          <section key={group.standing}>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <StandingDot standing={group.standing} />
              {standingLabel(group.standing, question)}
              <span className="font-sans text-sm font-normal text-muted tabular-nums">{group.rows.length}</span>
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((row) => (
                <SeatCard key={row.seat.id} row={row} question={question} />
              ))}
            </ul>
            {shown.length < group.rows.length && (
              <button type="button" className="mt-3 text-sm link" onClick={() => set({ standing: group.standing })}>
                Show all {group.rows.length}
              </button>
            )}
          </section>
        )
      })}
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

function SeatCard({ row, question }: { row: HeldSeat; question: Question }) {
  const inc = row.incumbent
  return (
    <li className="relative overflow-hidden rounded-xl border-2 border-ink bg-surface">
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
