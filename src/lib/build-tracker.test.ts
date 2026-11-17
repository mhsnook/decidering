import { describe, expect, it } from 'vitest'
import { act, decider, holder, link, office, question, reading, report, role, seat, source, stance, track } from './fixtures.ts'

const policy = question('policy')
const bill = question('bill', { parent_id: 'policy', kind: 'formal_act', implies_parent_support: true, sort: 1 })

describe("a decider's record on a question", () => {
  const tracker = track({
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
    })

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
    const both = track({
        deciders: [decider('ann')],
        questions: [policy, question('markup', { parent_id: 'policy' })],
        acts: [act('advance', 'ann')],
        readings: [reading('advance', 'markup', 'support'), reading('advance', 'policy', 'lean_oppose')],
      })
    expect(both.recordFor(both.questionById.get('markup')!, 'ann')[0].reading.position).toBe('support')
    expect(both.recordFor(policy, 'ann')[0].reading.position).toBe('lean_oppose')
  })

  it('takes footing from the acts on the record', () => {
    const tracked = track({
        deciders: [decider('ann')],
        seats: [seat('s1')],
        roles: [role('s1', 'ann')],
        questions: [policy, bill],
        stances: [stance('bill', 'ann', 'support')],
        acts: [act('signed', 'ann', { kind: 'formal_act' })],
        readings: [reading('signed', 'bill', 'support'), reading('signed', 'policy', 'support', 'bill')],
      })
    const [row] = tracked.board(bill)
    expect(row.incumbent).toMatchObject({ standing: 'support', footing: 'on_record' })
    expect(tracked.board(policy)[0].incumbent).toMatchObject({ standing: 'unknown', footing: 'on_record' })
  })
})

describe('asks', () => {
  const markup = question('markup', { parent_id: 'policy', sort: 5 })
  const hearing = question('hearing', { parent_id: 'policy', sort: 4, status: 'lapsed', closed_on: '2026-03-01' })
  const tracker = track({
      deciders: [decider('ann'), decider('bob'), decider('cy')],
      seats: [seat('s1'), seat('s2'), seat('s3')],
      roles: [role('s1', 'ann'), role('s2', 'bob'), role('s3', 'cy', { kind: 'challenger' })],
      questions: [policy, bill, markup, hearing],
      questionDeciders: [link('markup', 'bob', 'Chair'), link('hearing', 'ann', 'Vice chair')],
      stances: [stance('markup', 'bob', 'lean_support')],
    })

  it('keeps asks apart from the measures put to everyone', () => {
    expect(tracker.measuresOf.get('policy')?.map((q) => q.id)).toEqual(['bill'])
    expect(tracker.asksOf.get('policy')?.map((q) => q.id)).toEqual(['markup', 'hearing'])
  })

  it('names the people each ask is put to, open asks first', () => {
    expect(tracker.keyPeople(policy).map((k) => [k.ask.id, k.contender.decider.id, k.roleLabel, k.contender.standing])).toEqual([
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

describe('viewing a body on a day', () => {
  const policy = question('policy')
  const markup = question('markup', { parent_id: 'policy', title: 'Will they commit to a markup?' })
  const TERM = '2027-01-03'
  const rows = {
    deciders: [decider('crapo'), decider('wyden'), decider('old'), decider('new')],
    seats: [seat('id'), seat('or'), seat('tx')],
    roles: [role('id', 'crapo'), role('or', 'wyden'), role('tx', 'old', { ends_on: TERM }), role('tx', 'new', { starts_on: TERM })],
    questions: [policy, markup],
    offices: [office('chair', { label: 'Chair, Finance' })],
    officeHolders: [holder('chair', 'crapo', null, TERM), holder('chair', 'wyden', TERM)],
    questionOffices: [{ id: 'markup:chair', question_id: 'markup', office_id: 'chair' }],
    stances: [stance('markup', 'crapo', 'oppose'), stance('policy', 'old', 'support'), stance('policy', 'new', 'lean_support')],
  }
  const now = track(rows)
  const next = track(rows, '2027-01-31')

  it('fills each seat with whoever holds it that day', () => {
    const holderOf = (t: typeof now, seatId: string) => t.board(policy).find((r) => r.seat.id === seatId)?.incumbent?.decider.id
    expect(holderOf(now, 'tx')).toBe('old')
    expect(holderOf(next, 'tx')).toBe('new')
    expect(now.board(policy).map((r) => r.incumbent?.standing)).toEqual(['unknown', 'unknown', 'support'])
    expect(next.board(policy).map((r) => r.incumbent?.standing)).toEqual(['unknown', 'unknown', 'lean_support'])
  })

  it('hands the seat over on the day itself, with nobody holding it twice', () => {
    const onTheDay = track(rows, TERM)
    expect(onTheDay.rolesBySeat.get('tx')?.map((r) => r.decider_id)).toEqual(['new'])
    expect(track(rows, '2027-01-02').rolesBySeat.get('tx')?.map((r) => r.decider_id)).toEqual(['old'])
  })

  it('puts an ask of an office to whoever sits in it that day, under the title of the office', () => {
    expect(now.keyPeople(policy).map((k) => [k.contender.decider.id, k.roleLabel, k.contender.standing])).toEqual([['crapo', 'Chair, Finance', 'oppose']])
    expect(next.keyPeople(policy).map((k) => [k.contender.decider.id, k.roleLabel, k.contender.standing])).toEqual([['wyden', 'Chair, Finance', 'unknown']])
    expect(now.isAsk(markup)).toBe(true)
    expect([now.appliesTo(markup, 'wyden'), next.appliesTo(markup, 'wyden'), next.appliesTo(markup, 'crapo')]).toEqual([false, true, false])
    expect(next.board(markup).map((r) => r.incumbent?.decider.id)).toEqual(['wyden'])
  })

  it('keeps each holder their own position on the ask, and knows when they hold the office', () => {
    expect(next.stanceById.get('markup:crapo')?.position).toBe('oppose')
    expect(now.tenuresOn(markup, 'wyden').map((t) => [t.office.label, t.holder.starts_on])).toEqual([['Chair, Finance', TERM]])
    expect(now.officesHeldBy('crapo').map((o) => o.id)).toEqual(['chair'])
    expect(next.officesHeldBy('crapo')).toEqual([])
  })

  it('still finds the seat of someone who has left or not yet arrived', () => {
    expect(next.roleIn(policy, 'old')?.seat_id).toBe('tx')
    expect(now.roleIn(policy, 'new')?.seat_id).toBe('tx')
  })
})
