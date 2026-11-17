import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Question } from '../../shared/schema.ts'
import { hemicycleLayout, thresholdPath } from '../lib/hemicycle.ts'
import { SPECTRUM, STANDING_COLOR, standingLabel } from '../lib/position.ts'
import type { HeldSeat } from '../lib/tracker.tsx'
import { FootingTag, StandingDot } from './bits.tsx'

const UNIT = 100
// Room above the outer arc for the threshold line to stand clear of the seats.
const HEADROOM = 7

export function Hemicycle({
  title,
  rows,
  question,
  isLit,
}: {
  title: string
  rows: HeldSeat[]
  question: Question
  isLit: (row: HeldSeat) => boolean
}) {
  const navigate = useNavigate()
  const lastPointer = useRef('mouse')
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

  const seats = useMemo(
    () =>
      rows
        .filter((r) => r.seat.is_voting)
        .sort(
          (a, b) =>
            SPECTRUM.indexOf(a.incumbent.standing) - SPECTRUM.indexOf(b.incumbent.standing) ||
            a.seat.label.localeCompare(b.seat.label, undefined, { numeric: true }),
        ),
    [rows],
  )
  const layout = useMemo(() => hemicycleLayout(seats.length), [seats.length])
  if (seats.length === 0) return null

  const nonVoting = rows.length - seats.length
  const needed = question.threshold ?? Math.floor(seats.length / 2) + 1
  const yes = seats.filter((r) => r.incumbent.standing === 'support').length
  const r = layout.dotRadius * UNIT
  const edge = UNIT + r
  const view = { x: -edge, y: -edge - HEADROOM, w: edge * 2, h: edge + HEADROOM + r }
  // Where a point in chart units sits inside the SVG's box, as fractions of it.
  const place = (x: number, y: number) => ({ left: (x - view.x) / view.w, top: (y - view.y) / view.h })

  // The line leaves the chart heading outward, then bends straight up to its label.
  const line = thresholdPath(layout, needed).map((p) => ({ x: p.x * UNIT, y: p.y * UNIT }))
  const [lineExit, lineEnd] = line.slice(-2)
  const bend = Math.min(4, (lineEnd.y - view.y) / 2)
  const backOff = bend / Math.hypot(lineEnd.x - lineExit.x, lineEnd.y - lineExit.y)
  const flag = place(lineEnd.x, view.y)
  const point = (p: { x: number; y: number }) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`
  const linePath = [
    `M${line.slice(0, -1).map(point).join(' L')}`,
    `L${point({ x: lineEnd.x + (lineExit.x - lineEnd.x) * backOff, y: lineEnd.y + (lineExit.y - lineEnd.y) * backOff })}`,
    `Q${point(lineEnd)} ${point({ x: lineEnd.x, y: lineEnd.y - bend })}`,
    `V${view.y.toFixed(2)}`,
  ].join(' ')

  const shownIndex = seats.findIndex((s) => s.seat.id === (hovered ?? pinned))
  const shown = seats[shownIndex]
  const tip = shown && place(layout.dots[shownIndex].x * UNIT, layout.dots[shownIndex].y * UNIT - r)

  function seatAt(e: MouseEvent<SVGSVGElement>): HeldSeat | undefined {
    const box = e.currentTarget.getBoundingClientRect()
    const scale = view.w / box.width
    const x = ((e.clientX - box.left) * scale + view.x) / UNIT
    const y = ((e.clientY - box.top) * scale + view.y) / UNIT
    let best: HeldSeat | undefined
    let reach = layout.pitch
    layout.dots.forEach((d, i) => {
      const distance = Math.hypot(d.x - x, d.y - y)
      if (distance < reach) [best, reach] = [seats[i], distance]
    })
    return best
  }

  function onClick(e: MouseEvent<SVGSVGElement>) {
    const hit = seatAt(e)
    // A finger can't hover, so the first tap names the seat and the second opens it.
    if (!hit || (lastPointer.current === 'touch' && pinned !== hit.seat.id)) return setPinned(hit?.seat.id ?? null)
    navigate({ to: '/q/$slug/$decider', params: { slug: question.slug, decider: hit.incumbent.decider.slug } })
  }

  const summary = SPECTRUM.map((s) => [s, seats.filter((row) => row.incumbent.standing === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${standingLabel(s, question)}: ${n}`)
    .join(', ')
  const flagText = question.threshold ? `${needed} needed` : `${needed} is a majority`

  return (
    <figure className="card p-4 sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted">
          {seats.length} voting {seats.length === 1 ? 'seat' : 'seats'}
          {nonVoting > 0 && ` · ${nonVoting} non-voting not drawn`}
        </p>
      </figcaption>

      <div className="relative mx-auto mt-5" style={{ maxWidth: Math.min(640, (2.2 * 15) / layout.dotRadius) }}>
        {/* Each overlay slides its own anchor by the same fraction it sits at, so it never leaves the chart. */}
        <p
          className="absolute top-0 text-xs font-medium whitespace-nowrap"
          style={{ left: `${flag.left * 100}%`, transform: `translate(${-flag.left * 100}%, -100%)` }}
        >
          <span className="tabular-nums">{needed}</span>
          {flagText.slice(String(needed).length)}
        </p>
        <svg
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          role="img"
          aria-label={`${title}. ${summary}. ${flagText}.`}
          className={`block w-full touch-manipulation overflow-visible ${hovered ? 'cursor-pointer' : ''}`}
          onPointerDown={(e) => (lastPointer.current = e.pointerType)}
          onPointerMove={(e) => e.pointerType !== 'touch' && setHovered(seatAt(e)?.seat.id ?? null)}
          onPointerLeave={() => setHovered(null)}
          onClick={onClick}
        >
          {seats.map((row, i) => {
            const { standing } = row.incumbent
            const hollow = standing === 'unknown'
            const active = shown?.seat.id === row.seat.id
            return (
              <g key={row.seat.id} opacity={active || isLit(row) ? 1 : 0.18} stroke="var(--color-ink)" strokeWidth={r * (active ? 0.3 : 0.12)}>
                {!hollow && <circle cx={layout.dots[i].x * UNIT} cy={layout.dots[i].y * UNIT + r * 0.24} r={r * 0.9} fill="var(--color-ink)" />}
                <circle
                  cx={layout.dots[i].x * UNIT}
                  cy={layout.dots[i].y * UNIT}
                  r={r * 0.9}
                  fill={hollow ? 'none' : STANDING_COLOR[standing]}
                  strokeDasharray={hollow && !active ? `${r * 0.32} ${r * 0.22}` : undefined}
                />
              </g>
            )
          })}
          <path d={linePath} fill="none" stroke="var(--color-ink)" strokeWidth={0.5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <p className="pointer-events-none absolute inset-x-0 bottom-0 text-center leading-none">
          <span className="block font-display text-2xl font-black tabular-nums sm:text-4xl">{yes}</span>
          <span className="text-[11px] text-muted sm:text-xs">{standingLabel('support', question).toLowerCase()}</span>
        </p>

        {shown && tip && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 w-max max-w-56 rounded-xl border-2 border-ink bg-surface px-2.5 py-1.5 text-xs shadow-hard-sm"
            style={{ left: `${tip.left * 100}%`, top: `${tip.top * 100}%`, transform: `translate(${-tip.left * 100}%, calc(-100% - 6px))` }}
          >
            <p className="text-sm font-semibold">{shown.incumbent.decider.name}</p>
            <p className="text-muted">
              {shown.seat.label}
              {shown.incumbent.role.affiliation && ` · ${shown.incumbent.role.affiliation}`}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <StandingDot standing={shown.incumbent.standing} />
              {standingLabel(shown.incumbent.standing, question)}
              {shown.incumbent.footing !== 'unknown' && <FootingTag footing={shown.incumbent.footing} />}
            </p>
            {!hovered && <p className="mt-1 text-muted">Tap again to open</p>}
          </div>
        )}
      </div>
    </figure>
  )
}
