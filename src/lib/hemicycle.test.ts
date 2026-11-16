import { describe, expect, it } from 'vitest'
import { hemicycleLayout, thresholdPath } from './hemicycle.ts'

describe('hemicycleLayout', () => {
  it.each([1, 2, 7, 12, 13, 55, 100, 433, 435, 650])('seats %i without overlap', (n) => {
    const { dots, dotRadius } = hemicycleLayout(n)
    expect(dots).toHaveLength(n)
    for (const d of dots) {
      expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(1 + 1e-9)
      expect(d.y).toBeLessThanOrEqual(1e-9)
    }
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        expect(Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y)).toBeGreaterThan(dotRadius * 2)
      }
    }
  })

  it('orders seats left to right, so a bloc fills a wedge from one side', () => {
    const { dots } = hemicycleLayout(100)
    const angles = dots.map((d) => d.angle)
    expect(angles).toEqual([...angles].sort((a, b) => b - a))
    // Rows with an odd count put one seat dead centre, hence the tolerance.
    expect(dots.slice(0, 50).every((d) => d.x < 1e-9)).toBe(true)
    expect(dots.slice(50).every((d) => d.x > -1e-9)).toBe(true)
  })

})

describe('thresholdPath', () => {
  const cases = [
    [50, 38],
    [433, 217],
    [100, 51],
    [100, 60],
    [7, 4],
    [435, 290],
    [50, 1],
    [50, 50],
    [13, 7],
  ]

  it.each(cases)('with %i seats, puts exactly %i on its left without touching one', (n, threshold) => {
    const layout = hemicycleLayout(n)
    const path = thresholdPath(layout, threshold)
    // The line can pass below the baseline at either end of a row, where atan2
    // would wrap round.
    const angleOf = (p: { x: number; y: number }) => {
      const angle = Math.atan2(-p.y, p.x)
      return angle < -Math.PI / 2 ? angle + 2 * Math.PI : angle
    }

    for (const point of path) {
      for (const seat of layout.dots) {
        expect(Math.hypot(point.x - seat.x, point.y - seat.y)).toBeGreaterThan(layout.dotRadius * 1.1)
      }
    }
    // The line crosses a row's circle once, in the gap, so a seat is on its left
    // if it sits at a greater angle than the line does there.
    layout.dots.forEach((seat, i) => {
      const crossing = path.find((p) => Math.hypot(p.x, p.y) >= layout.radii[seat.row])!
      expect(seat.angle > angleOf(crossing)).toBe(i < threshold)
    })
  })

  it.each(cases)('with %i seats and %i needed, never bends tighter than a seat', (n, threshold) => {
    const layout = hemicycleLayout(n)
    const path = thresholdPath(layout, threshold)
    for (let i = 1; i < path.length - 1; i++) {
      const [a, b, c] = [path[i - 1], path[i], path[i + 1]]
      const before = Math.atan2(b.y - a.y, b.x - a.x)
      const after = Math.atan2(c.y - b.y, c.x - b.x)
      expect(Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)))).toBeLessThan(0.2)
      // The radius of the circle through three neighbouring points.
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
      const sides = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) * Math.hypot(c.x - a.x, c.y - a.y)
      if (area > 1e-12) expect(sides / (4 * area)).toBeGreaterThan(layout.dotRadius)
    }
  })

  it('runs from inside the inner row to outside the outer one', () => {
    const layout = hemicycleLayout(100)
    const path = thresholdPath(layout, 51)
    expect(Math.hypot(path[0].x, path[0].y)).toBeLessThan(layout.radii[0] - layout.dotRadius)
    expect(Math.hypot(path.at(-1)!.x, path.at(-1)!.y)).toBeGreaterThan(1 + layout.dotRadius)
  })
})
