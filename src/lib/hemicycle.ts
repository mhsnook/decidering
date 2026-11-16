export type Seat = { x: number; y: number; row: number; angle: number }

export type HemicycleLayout = {
  // Seats ordered left to right by angle. The outer arc has radius 1, its centre
  // is the origin, and y grows downward as it does in SVG. Angles run from pi on
  // the left to 0 on the right.
  dots: Seat[]
  // Row radii, innermost first. Rows are one `pitch` apart, and no two seats in
  // a row are closer than that.
  radii: number[]
  dotRadius: number
  pitch: number
}

const SINGLE_ROW_MAX = 12
// How much of the chart's radius the hollow middle may take. Rows are fitted by
// moving the inner edge within this range, aiming for the middle of it.
const INNER = { min: 0.3, ideal: 0.4, max: 0.7 }

const capacity = (radius: number, pitch: number) => Math.floor((Math.PI * radius) / pitch) + 1
const rowRadii = (rows: number, inner: number) => Array.from({ length: rows }, (_, i) => inner + (i * (1 - inner)) / (rows - 1))
const holds = (rows: number, inner: number) => rowRadii(rows, inner).reduce((sum, r) => sum + capacity(r, (1 - inner) / (rows - 1)), 0)

// Seats look evenly spread only when neighbours along a row are as far apart as
// the rows are. A given number of rows holds more seats the larger the hollow
// middle is, so for each row count find the hollow at which the seats exactly
// fill the rows, and take the row count whose hollow is nearest the ideal.
function rowsFor(n: number): { radii: number[]; pitch: number } {
  if (n <= SINGLE_ROW_MAX) return { radii: [1], pitch: Math.min(0.36, Math.PI / Math.max(n - 1, 1)) }
  let best: { rows: number; inner: number; full: boolean } | undefined
  for (let rows = 2; ; rows++) {
    if (holds(rows, INNER.max) < n) continue
    // Too many rows for these seats even with the smallest hollow: they would
    // sit spread out along each row, and more rows only make it worse.
    const full = holds(rows, INNER.min) < n
    let [low, high] = [INNER.min, INNER.max]
    while (full && high - low > 1e-4) {
      const middle = (low + high) / 2
      if (holds(rows, middle) >= n) high = middle
      else low = middle
    }
    const inner = full ? high : INNER.min
    if (!best || (full && Math.abs(inner - INNER.ideal) < Math.abs(best.inner - INNER.ideal))) best = { rows, inner, full }
    if (!full) break
  }
  return { radii: rowRadii(best!.rows, best!.inner), pitch: (1 - best!.inner) / (best!.rows - 1) }
}

export function hemicycleLayout(n: number): HemicycleLayout {
  const { radii, pitch } = rowsFor(n)
  const caps = radii.map((r) => capacity(r, pitch))
  const total = caps.reduce((a, b) => a + b, 0)

  // Share seats between rows in proportion to their length, handing the
  // leftovers to the rows with the largest remainders.
  const exact = caps.map((c) => (n * c) / total)
  const counts = exact.map(Math.floor)
  const byRemainder = exact.map((x, i) => ({ i, rest: x - counts[i] })).sort((a, b) => b.rest - a.rest)
  for (let k = 0, left = n - counts.reduce((a, b) => a + b, 0); k < left; k++) counts[byRemainder[k].i]++

  const seats = radii.flatMap((radius, row) =>
    Array.from({ length: counts[row] }, (_, j) => ({
      radius,
      row,
      angle: counts[row] === 1 ? Math.PI / 2 : Math.PI * (1 - j / (counts[row] - 1)),
    })),
  )
  seats.sort((a, b) => b.angle - a.angle || b.radius - a.radius)

  return {
    dots: seats.map((s) => ({ x: s.radius * Math.cos(s.angle), y: -s.radius * Math.sin(s.angle), row: s.row, angle: s.angle })),
    radii,
    dotRadius: Math.min(pitch * 0.41, 0.13),
    pitch,
  }
}

type Point = { x: number; y: number }

const plus = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const times = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const length = (a: Point) => Math.hypot(a.x, a.y)
const outwardAt = (a: Point) => times(a, 1 / length(a))
const onChart = (radius: number, angle: number): Point => ({ x: radius * Math.cos(angle), y: -radius * Math.sin(angle) })

// Points along the circular arc that leaves `from` heading along `heading` and
// arrives at `to`.
function arc(from: Point, heading: Point, to: Point): Point[] {
  const across = { x: -heading.y, y: heading.x }
  const chord = minus(to, from)
  const offCourse = dot(across, chord)
  if (Math.abs(offCourse) < 1e-9 * length(chord)) return [from, to]
  const centre = plus(from, times(across, dot(chord, chord) / (2 * offCourse)))
  const radius = length(minus(from, centre))
  const start = Math.atan2(from.y - centre.y, from.x - centre.x)
  const end = Math.atan2(to.y - centre.y, to.x - centre.x)
  const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start))
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 0.06))
  return Array.from({ length: steps + 1 }, (_, k) => ({
    x: centre.x + radius * Math.cos(start + (sweep * k) / steps),
    y: centre.y + radius * Math.sin(start + (sweep * k) / steps),
  }))
}

// An S made of two arcs that leaves `from` heading along `leaving`, arrives at
// `to` heading along `arriving`, and has no kink where the arcs meet.
function sBend(from: Point, leaving: Point, to: Point, arriving: Point): Point[] {
  const chord = minus(to, from)
  const both = plus(leaving, arriving)
  const spread = 2 * (1 - dot(leaving, arriving))
  const reach =
    spread < 1e-9 ? dot(chord, chord) / (4 * dot(chord, arriving)) : (-dot(chord, both) + Math.sqrt(dot(chord, both) ** 2 + spread * dot(chord, chord))) / spread
  const meet = times(plus(plus(from, to), times(minus(leaving, arriving), reach)), 0.5)
  // The second arc is traced backwards from its far end, where its heading is known.
  return [...arc(from, leaving, meet), ...arc(to, times(arriving, -1), meet).reverse().slice(1)]
}

// The same crossing for a step too far sideways for an S: a quarter turn into
// the empty band between the rows, a run along the band, and a quarter turn out
// of it. Both turns are true circles that just touch the band.
function viaBand(from: Point, to: Point, band: number): Point[] | undefined {
  const [near, far] = [length(from), length(to)]
  const side = Math.sign(from.x * to.y - from.y * to.x)
  if (side === 0) return undefined
  // Square to "outward" at each end, pointing the way the line has to travel.
  const across = (at: Point) => times({ x: -at.y, y: at.x }, side / length(at))
  const turnIn = plus(from, times(across(from), (band ** 2 - near ** 2) / (2 * band)))
  const turnOut = minus(to, times(across(to), (far ** 2 - band ** 2) / (2 * band)))
  const [joins, leaves] = [times(turnIn, band / length(turnIn)), times(turnOut, band / length(turnOut))]
  // The two turns overlap, so there is no band run to join them.
  if (Math.sign(joins.x * leaves.y - joins.y * leaves.x) !== side) return undefined
  const along = arc(joins, across(joins), leaves)
  return [...arc(from, outwardAt(from), joins), ...along.slice(1), ...arc(to, times(outwardAt(to), -1), leaves).reverse().slice(1)]
}

// A line from inside the chart to outside it with exactly the first `threshold`
// seats on its left. It crosses each row through the middle of the gap between
// two seats, heading straight outward. Where the next row's gap is off to one
// side it gets there on an S of two arcs, and where the gaps line up it runs
// straight. Returned as closely spaced points in the layout's coordinates.
export function thresholdPath(layout: HemicycleLayout, threshold: number): Point[] {
  const { dots, radii, pitch, dotRadius } = layout
  const rows = radii.map(() => ({ angles: [] as number[], left: 0 }))
  dots.forEach((seat, i) => {
    rows[seat.row].angles.push(seat.angle)
    if (i < threshold) rows[seat.row].left++
  })

  // Where the line crosses each row: midway between the last seat on its left
  // and the first on its right. Where a row sits wholly on one side, the
  // missing neighbour is imagined one step past its end.
  const gaps = rows.flatMap(({ angles, left }, row) => {
    if (angles.length === 0) return []
    const step = angles.length > 1 ? angles[0] - angles[1] : pitch / radii[row]
    const before = onChart(radii[row], left > 0 ? angles[left - 1] : angles[0] + step)
    const after = onChart(radii[row], left < angles.length ? angles[left] : angles[angles.length - 1] - step)
    return [{ at: times(plus(before, after), 0.5), row: radii[row], beside: [before, after] }]
  })

  const path: Point[] = [times(gaps[0].at, 1 - pitch / 2 / length(gaps[0].at)), gaps[0].at]
  for (let i = 0; i < gaps.length - 1; i++) {
    const [from, to] = [gaps[i], gaps[i + 1]]
    const seats = [...from.beside, ...to.beside]
    const clearance = (route: Point[]) => Math.min(...route.flatMap((point) => seats.map((seat) => length(minus(point, seat)))))
    const [leaving, arriving] = [outwardAt(from.at), outwardAt(to.at)]
    const routes = [sBend(from.at, leaving, to.at, arriving)]
    if (clearance(routes[0]) < 0.47 * pitch) {
      // An S that has to reach a long way sideways swings in close to a seat.
      // Two other ways across keep their distance. With room to spare, go by
      // way of the band. Without it, the tightest spot is between the two seats
      // on the shorter diagonal, so aim square through the middle of that.
      const around = viaBand(from.at, to.at, (from.row + to.row) / 2)
      if (around) routes.push(around)
      const [a, b] = length(minus(from.beside[0], to.beside[1])) <= length(minus(to.beside[0], from.beside[1])) ? [from.beside[0], to.beside[1]] : [to.beside[0], from.beside[1]]
      const pinch = times(plus(a, b), 0.5)
      const square = outwardAt({ x: -(b.y - a.y), y: b.x - a.x })
      const through = dot(square, minus(to.at, from.at)) < 0 ? times(square, -1) : square
      routes.push([...sBend(from.at, leaving, pinch, through), ...sBend(pinch, through, to.at, arriving).slice(1)])
    }
    path.push(...routes.reduce((best, route) => (clearance(route) > clearance(best) ? route : best)).slice(1))
  }
  const last = gaps[gaps.length - 1].at
  path.push(times(last, 1 + Math.max(pitch / 2, dotRadius + 0.03) / length(last)))
  // An arc with nothing to sweep leaves its start and end on the same spot.
  return path.filter((point, i) => i === 0 || length(minus(point, path[i - 1])) > pitch / 1000)
}
