import { describe, expect, it } from 'vitest'
import { buildTracker } from './build-tracker.ts'
import { act, data, decider, link, question, reading, report, role, seat, source, stance } from './fixtures.ts'

const policy = question('policy')
const bill = question('bill', { parent_id: 'policy', kind: 'formal_act', implies_parent_support: true, sort: 1 })

describe("a decider's record on a question", () => {
  const tracker = buildTracker(
    data({
      deciders: [decider('ann'), decider('bob')],
      questions: [policy, bill],
      sources: [source('release'), source('paper'), source('wire')],
      acts: [
        act('speech', 'ann', { occurred_on: '2026-02-11', primary_source_id: 'release' }),
        act('signed', 'ann', { kind: 'formal_act', occurred_on: '2026-01-05' }),
        act('hedge', 'ann', { occurred_on: '2026-03-01' }),
        act('bob-speech', 'bob', { occurred_on: '2026-02-12' }),
      ],
      reports: [
        report('paper', 'speech', { created_at: '2026-02-12T00:00:00.000Z' }),
        report('wire', 'speech', { created_at: '2026-02-13T00:00:00.000Z' }),
        report('release', 'speech', { created_at: '2026-02-14T00:00:00.000Z' }),
        report('paper', 'signed'),
        report('paper', 'hedge'),
        report('wire', 'bob-speech'),
      ],
      readings: [
        reading('speech', 'policy', 'support'),
        reading('signed', 'bill', 'support'),
        reading('signed', 'policy', 'support', 'bill'),
        reading('hedge', 'bill', 'mixed'),
        reading('bob-speech', 'policy', 'oppose'),
      ],
    }),
  )

  it('is the readings on that question for that decider, newest act first', () => {
    expect(tracker.recordFor(policy, 'ann').map((e) => e.act.id)).toEqual(['speech', 'signed'])
    expect(tracker.recordFor(policy, 'bob').map((e) => [e.act.id, e.reading.position])).toEqual([['bob-speech', 'oppose']])
  })

  it('lists one act once however many sources report it, the record of the act itself first', () => {
    const [speech] = tracker.recordFor(policy, 'ann')
    expect(speech.reports.map((r) => r.source.id)).toEqual(['release', 'paper', 'wire'])
  })

  it('shows a reading on a sub-question on the parent only when it was written there too', () => {
    expect(tracker.recordFor(bill, 'ann').map((e) => e.act.id)).toEqual(['hedge', 'signed'])
    const signed = tracker.recordFor(policy, 'ann').find((e) => e.act.id === 'signed')
    expect(signed?.via?.id).toBe('bill')
    expect(tracker.recordFor(policy, 'ann').some((e) => e.act.id === 'hedge')).toBe(false)
  })

  it('lets one act read differently on two questions', () => {
    const both = buildTracker(
      data({
        deciders: [decider('ann')],
        questions: [policy, question('markup', { parent_id: 'policy' })],
        acts: [act('advance', 'ann')],
        readings: [reading('advance', 'markup', 'support'), reading('advance', 'policy', 'lean_oppose')],
      }),
    )
    expect(both.recordFor(both.questionById.get('markup')!, 'ann')[0].reading.position).toBe('support')
    expect(both.recordFor(policy, 'ann')[0].reading.position).toBe('lean_oppose')
  })

  it('takes footing from the acts on the record', () => {
    const tracked = buildTracker(
      data({
        deciders: [decider('ann')],
        seats: [seat('s1')],
        roles: [role('s1', 'ann')],
        questions: [policy, bill],
        stances: [stance('bill', 'ann', 'support')],
        acts: [act('signed', 'ann', { kind: 'formal_act' })],
        readings: [reading('signed', 'bill', 'support'), reading('signed', 'policy', 'support', 'bill')],
      }),
    )
    const [row] = tracked.board(bill)
    expect(row.incumbent).toMatchObject({ standing: 'support', footing: 'on_record' })
    expect(tracked.board(policy)[0].incumbent).toMatchObject({ standing: 'unknown', footing: 'on_record' })
  })
})

describe('asks', () => {
  const markup = question('markup', { parent_id: 'policy', sort: 5 })
  const hearing = question('hearing', { parent_id: 'policy', sort: 4, status: 'lapsed', closed_on: '2026-03-01' })
  const tracker = buildTracker(
    data({
      deciders: [decider('ann'), decider('bob'), decider('cy')],
      seats: [seat('s1'), seat('s2'), seat('s3')],
      roles: [role('s1', 'ann'), role('s2', 'bob'), role('s3', 'cy', { kind: 'challenger' })],
      questions: [policy, bill, markup, hearing],
      questionDeciders: [link('markup', 'bob', 'Chair'), link('hearing', 'ann', 'Vice chair')],
      stances: [stance('markup', 'bob', 'lean_support')],
    }),
  )

  it('keeps asks apart from the measures put to everyone', () => {
    expect(tracker.measuresOf.get('policy')?.map((q) => q.id)).toEqual(['bill'])
    expect(tracker.asksOf.get('policy')?.map((q) => q.id)).toEqual(['markup', 'hearing'])
  })

  it('names the people each ask is put to, open asks first', () => {
    expect(tracker.keyPeople(policy).map((k) => [k.ask.id, k.contender.decider.id, k.link.role_label, k.contender.standing])).toEqual([
      ['markup', 'bob', 'Chair', 'lean_support'],
      ['hearing', 'ann', 'Vice chair', 'unknown'],
    ])
    expect(tracker.asksFor(policy, 'ann').map((k) => k.ask.id)).toEqual(['hearing'])
  })

  it('puts only the named people on the board of an ask', () => {
    expect(tracker.board(markup).map((r) => r.incumbent?.decider.id)).toEqual(['bob'])
    expect(tracker.board(policy)).toHaveLength(3)
    expect(tracker.appliesTo(markup, 'ann')).toBe(false)
  })
})
