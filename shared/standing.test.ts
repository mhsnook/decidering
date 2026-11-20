import { describe, expect, it } from 'vitest'
import type { Direction, Weight } from './schema.ts'
import { calculatePosition, footingOf, isAcross, type Read } from './standing.ts'

const now = new Date('2026-11-12T00:00:00Z')
const said = (occurred_on: string) => ({ occurred_on, onRecord: false })
const bound = (occurred_on: string) => ({ occurred_on, onRecord: true })

describe('footingOf', () => {
  it('is unknown with nothing on file', () => {
    expect(footingOf([], now)).toBe('unknown')
  })

  it('treats an act that binds as standing, however old and however alone', () => {
    expect(footingOf([bound('2019-01-01')], now)).toBe('on_record')
    expect(footingOf([said('2026-11-01'), bound('2021-06-01')], now)).toBe('on_record')
  })

  it('calls a single statement sparse even when it is recent', () => {
    expect(footingOf([said('2026-11-01')], now)).toBe('sparse')
  })

  it('calls it stale once the newest statement is over two years old', () => {
    expect(footingOf([said('2023-04-12')], now)).toBe('stale')
    expect(footingOf([said('2023-04-12'), said('2022-01-01')], now)).toBe('stale')
  })

  it('separates fresh from established by the newest statement', () => {
    expect(footingOf([said('2025-01-22'), said('2026-10-02')], now)).toBe('fresh')
    expect(footingOf([said('2025-01-22'), said('2025-07-30')], now)).toBe('established')
  })
})

const read = (weight: Weight, position: Direction, occurred_on: string, inForce = true): Read => ({ position, weight, occurred_on, inForce })

describe('calculatePosition', () => {
  it('is null with nothing on the record', () => {
    expect(calculatePosition([])).toBeNull()
  })

  it('does not count a commitment that was taken back', () => {
    expect(calculatePosition([read('concrete', 'support', '2026-01-01', false)])).toBeNull()
    expect(calculatePosition([read('concrete', 'support', '2026-01-01', false), read('clear', 'oppose', '2025-06-01')])).toBe('oppose')
  })

  it('takes a concrete act as where they stand, however old', () => {
    expect(calculatePosition([read('concrete', 'oppose', '2015-03-01')])).toBe('oppose')
    expect(calculatePosition([read('concrete', 'lean_support', '2015-03-01')])).toBe('lean_support')
  })

  it('lets the most recent concrete act decide, so a later one supersedes an earlier one', () => {
    expect(calculatePosition([read('concrete', 'support', '2020-01-01'), read('concrete', 'oppose', '2026-01-01')])).toBe('oppose')
    expect(calculatePosition([read('concrete', 'oppose', '2020-01-01'), read('concrete', 'support', '2026-01-01')])).toBe('support')
    expect(calculatePosition([read('concrete', 'support', '2020-01-01'), read('concrete', 'lean_support', '2026-01-01')])).toBe('lean_support')
  })

  it('is mixed for concrete acts on both sides on the same day', () => {
    expect(calculatePosition([read('concrete', 'support', '2026-01-01'), read('concrete', 'oppose', '2026-01-01')])).toBe('mixed')
  })

  it('moves one step toward the middle for a clear statement on another side after the last concrete act', () => {
    expect(calculatePosition([read('concrete', 'support', '2026-01-01'), read('clear', 'oppose', '2026-02-01')])).toBe('lean_support')
    expect(calculatePosition([read('concrete', 'oppose', '2026-01-01'), read('clear', 'support', '2026-02-01')])).toBe('lean_oppose')
    expect(calculatePosition([read('concrete', 'lean_support', '2026-01-01'), read('clear', 'oppose', '2026-02-01')])).toBe('mixed')
    expect(calculatePosition([read('concrete', 'support', '2026-01-01'), read('clear', 'mixed', '2026-02-01')])).toBe('lean_support')
  })

  it('leaves a concrete act where it is for a clear statement made before it, on the same day or on the same side', () => {
    expect(calculatePosition([read('concrete', 'support', '2026-01-01'), read('clear', 'oppose', '2025-12-01')])).toBe('support')
    expect(calculatePosition([read('concrete', 'support', '2026-01-01'), read('clear', 'oppose', '2026-01-01')])).toBe('support')
    expect(calculatePosition([read('concrete', 'support', '2026-01-01'), read('clear', 'lean_support', '2026-02-01')])).toBe('support')
  })

  it('measures a clear statement against the last concrete act, not the first', () => {
    const reads = [read('concrete', 'support', '2024-01-01'), read('clear', 'oppose', '2025-01-01'), read('concrete', 'support', '2026-01-01')]
    expect(calculatePosition(reads)).toBe('support')
  })

  it('goes by the most recent clear statement after a concrete act, not an earlier one', () => {
    const reads = [read('concrete', 'support', '2026-01-01'), read('clear', 'oppose', '2026-02-01'), read('clear', 'support', '2026-03-01')]
    expect(calculatePosition(reads)).toBe('support')
  })

  it('takes the most recent clear statement when there is no concrete act', () => {
    expect(calculatePosition([read('clear', 'support', '2025-01-01'), read('clear', 'oppose', '2026-01-01')])).toBe('oppose')
    expect(calculatePosition([read('clear', 'oppose', '2026-01-01'), read('clear', 'lean_support', '2025-01-01')])).toBe('oppose')
  })

  it('is mixed when clear statements made on the same day point both ways', () => {
    expect(calculatePosition([read('clear', 'support', '2026-01-01'), read('clear', 'oppose', '2026-01-01')])).toBe('mixed')
  })

  it('ignores passing remarks once there is a clear statement or a concrete act', () => {
    expect(calculatePosition([read('clear', 'support', '2025-01-01'), read('passing', 'oppose', '2026-01-01')])).toBe('support')
    expect(calculatePosition([read('concrete', 'support', '2025-01-01'), read('passing', 'oppose', '2026-01-01')])).toBe('support')
  })

  it('gives only a lean when all there is are passing remarks, going by the most recent', () => {
    expect(calculatePosition([read('passing', 'support', '2026-01-01')])).toBe('lean_support')
    expect(calculatePosition([read('passing', 'oppose', '2026-01-01')])).toBe('lean_oppose')
    expect(calculatePosition([read('passing', 'lean_support', '2026-01-01')])).toBe('lean_support')
    expect(calculatePosition([read('passing', 'mixed', '2026-01-01')])).toBe('mixed')
    expect(calculatePosition([read('passing', 'support', '2025-01-01'), read('passing', 'oppose', '2026-01-01')])).toBe('lean_oppose')
  })
})

describe('isAcross', () => {
  it('is true for a reading on the other side of a position, lean or not', () => {
    expect(isAcross('support', 'oppose')).toBe(true)
    expect(isAcross('lean_oppose', 'lean_support')).toBe(true)
    expect(isAcross('oppose', 'support')).toBe(true)
  })

  it('is false on the same side, and whenever either one is mixed', () => {
    expect(isAcross('support', 'lean_support')).toBe(false)
    expect(isAcross('lean_oppose', 'oppose')).toBe(false)
    expect(isAcross('mixed', 'oppose')).toBe(false)
    expect(isAcross('support', 'mixed')).toBe(false)
  })
})
