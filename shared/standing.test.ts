import { describe, expect, it } from 'vitest'
import { footingOf } from './standing.ts'

const now = new Date('2026-11-12T00:00:00Z')
const said = (occurred_on: string) => ({ kind: 'statement' as const, occurred_on })

describe('footingOf', () => {
  it('is unknown with nothing on file', () => {
    expect(footingOf([], now)).toBe('unknown')
  })

  it('treats a recorded act as standing, however old and however alone', () => {
    expect(footingOf([{ kind: 'formal_act', occurred_on: '2019-01-01' }], now)).toBe('on_record')
    expect(footingOf([said('2026-11-01'), { kind: 'vote', occurred_on: '2021-06-01' }], now)).toBe('on_record')
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
