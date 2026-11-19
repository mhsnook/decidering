import { describe, expect, it } from 'vitest'
import type { Act, Reading, Report, Stance } from '../../shared/schema.ts'
import { planReview, type ItemVerdict, type Published, type Write } from './review-plan.ts'
import { act, item, proposal, question, reading, report, source, stance } from './fixtures.ts'

const NOW = '2026-11-17T12:00:00.000Z'
const ids = () => {
  let n = 0
  return () => `new-${++n}`
}

const policy = question('policy')
const bill = question('bill', { parent_id: 'policy', kind: 'formal_act', implies_on_parent: 'support' })
const markup = question('markup', { parent_id: 'policy' })
const article = source('article', { title: 'As submitted' })
const pending = proposal('p1', 'article')

const published = (over: Partial<Published> = {}): Published => ({ questions: [policy, bill, markup], acts: [], reports: [], readings: [], stances: [], ...over })

const accept = (i: ReturnType<typeof item>, over: Partial<Extract<ItemVerdict, { accept: true }>> = {}): ItemVerdict => ({
  item: i,
  accept: true,
  question_id: i.question_id,
  act_id: i.act_id,
  kind: 'says',
  occurred_on: '2026-11-10',
  quote: i.quote,
  reading: 'support',
  bearing: 'direct',
  position: 'support',
  summary: null,
  comment: null,
  ...over,
})

const rowsOf = <T>(writes: Write[], on: Write['on']) => writes.filter((w) => w.on === on && w.type === 'insert').map((w) => (w as unknown as { row: T }).row)
const updatesOf = (writes: Write[], on: Write['on']) => writes.filter((w) => w.on === on && w.type === 'update').map((w) => w as { id: string; changes: Record<string, unknown> })

describe('planReview', () => {
  it('publishes several items from one article in a single plan', () => {
    const ann = item('i1', 'p1', 'ann', 'policy')
    const bob = item('i2', 'p1', 'bob', 'policy', { sort: 1 })
    const cy = item('i3', 'p1', 'cy', 'policy', { sort: 2 })
    const writes = planReview(
      published(),
      pending,
      article,
      {
        source_title: 'Paper: the headline',
        review_note: 'Read in full.',
        items: [accept(ann, { summary: 'For it.' }), accept(bob, { reading: 'oppose', position: 'lean_oppose' }), { item: cy, accept: false, comment: 'Not in the article.' }],
      },
      NOW,
      ids(),
    )

    expect(rowsOf<Act>(writes, 'acts').map((a) => [a.id, a.decider_id, a.body])).toEqual([
      ['act-of-i1', 'ann', 'words of i1'],
      ['act-of-i2', 'bob', 'words of i2'],
    ])
    expect(rowsOf<Report>(writes, 'reports').map((r) => [r.source_id, r.act_id, r.excerpt])).toEqual([
      ['article', 'act-of-i1', null],
      ['article', 'act-of-i2', null],
    ])
    expect(rowsOf<Reading>(writes, 'readings').map((r) => [r.act_id, r.question_id, r.position])).toEqual([
      ['act-of-i1', 'policy', 'support'],
      ['act-of-i2', 'policy', 'oppose'],
    ])
    expect(rowsOf<Stance>(writes, 'stances').map((s) => [s.id, s.position, s.summary])).toEqual([
      ['policy:ann', 'support', 'For it.'],
      ['policy:bob', 'lean_oppose', null],
    ])
    expect(updatesOf(writes, 'proposal_items').map((u) => [u.id, u.changes.status])).toEqual([
      ['i1', 'accepted'],
      ['i2', 'accepted'],
      ['i3', 'rejected'],
    ])
    expect(updatesOf(writes, 'sources')).toEqual([{ on: 'sources', type: 'update', id: 'article', changes: { title: 'Paper: the headline' } }])
    expect(updatesOf(writes, 'proposals')).toEqual([{ on: 'proposals', type: 'update', id: 'p1', changes: { status: 'reviewed', reviewed_at: NOW } }])
    expect(rowsOf<{ proposal_item_id: string | null; body: string }>(writes, 'proposal_notes').map((n) => [n.proposal_item_id, n.body])).toEqual([
      ['i3', 'Not in the article.'],
      [null, 'Read in full.'],
    ])
  })

  it('writes every table after the ones its rows point at', () => {
    const writes = planReview(published(), pending, article, { source_title: 'New title', review_note: 'x', items: [accept(item('i1', 'p1', 'ann', 'bill'))] }, NOW, ids())
    const order = [...new Set(writes.map((w) => w.on))]
    expect(order).toEqual(['sources', 'acts', 'reports', 'readings', 'stances', 'proposal_items', 'proposal_notes', 'proposals'])
  })

  it('reads one act on two questions without publishing it twice', () => {
    const onMarkup = item('i1', 'p1', 'ann', 'markup', { act_id: 'shared' })
    const onPolicy = item('i2', 'p1', 'ann', 'policy', { act_id: 'shared', sort: 1 })
    const writes = planReview(
      published(),
      pending,
      article,
      { source_title: article.title, review_note: null, items: [accept(onMarkup), accept(onPolicy, { reading: 'lean_oppose', position: 'lean_oppose' })] },
      NOW,
      ids(),
    )
    expect(rowsOf<Act>(writes, 'acts').map((a) => a.id)).toEqual(['shared'])
    expect(rowsOf<Report>(writes, 'reports')).toHaveLength(1)
    expect(rowsOf<Reading>(writes, 'readings').map((r) => [r.question_id, r.position, r.via_question_id])).toEqual([
      ['markup', 'support', null],
      ['policy', 'lean_oppose', null],
    ])
  })

  it('does not count a reading on a sub-question toward its parent', () => {
    const writes = planReview(published(), pending, article, { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'markup'))] }, NOW, ids())
    expect(rowsOf<Reading>(writes, 'readings').map((r) => r.question_id)).toEqual(['markup'])
    expect(rowsOf<Stance>(writes, 'stances').map((s) => s.id)).toEqual(['markup:ann'])
  })

  it('also records support on the parent when the question says support there implies it', () => {
    const writes = planReview(
      published(),
      pending,
      article,
      { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'bill'), { kind: 'commits', summary: 'Cosponsor.' })] },
      NOW,
      ids(),
    )
    expect(rowsOf<Reading>(writes, 'readings').map((r) => [r.question_id, r.position, r.via_question_id])).toEqual([
      ['bill', 'support', null],
      ['policy', 'support', 'bill'],
    ])
    expect(rowsOf<Stance>(writes, 'stances').map((s) => [s.id, s.position, s.summary])).toEqual([
      ['bill:ann', 'support', 'Cosponsor.'],
      ['policy:ann', 'support', 'Cosponsor.'],
    ])
  })

  it('leaves the parent alone when the reading is not support, or the parent already has a view', () => {
    const mixed = planReview(published(), pending, article, { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'bill'), { reading: 'mixed', position: 'mixed' })] }, NOW, ids())
    expect(rowsOf<Reading>(mixed, 'readings').map((r) => r.question_id)).toEqual(['bill'])

    const held = published({ stances: [stance('policy', 'ann', 'lean_oppose', 'Wary.')] })
    const support = planReview(held, pending, article, { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'bill'))] }, NOW, ids())
    expect(rowsOf<Stance>(support, 'stances').map((s) => s.id)).toEqual(['bill:ann'])
    expect(updatesOf(support, 'stances')).toEqual([])
  })

  it('adds a report to an act already on file instead of a second act', () => {
    const onFile = published({
      acts: [act('feb-11', 'ann')],
      reports: [report('release', 'feb-11')],
      readings: [reading('feb-11', 'policy', 'lean_support')],
      stances: [stance('policy', 'ann', 'lean_support', 'Leaning.')],
    })
    const writes = planReview(
      onFile,
      pending,
      article,
      { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'policy'), { act_id: 'feb-11', quote: 'As the paper words it.', position: 'support', summary: 'Now for it.' })] },
      NOW,
      ids(),
    )
    expect(rowsOf<Act>(writes, 'acts')).toEqual([])
    expect(rowsOf<Report>(writes, 'reports').map((r) => [r.source_id, r.act_id, r.excerpt])).toEqual([['article', 'feb-11', 'As the paper words it.']])
    expect(rowsOf<Reading>(writes, 'readings')).toEqual([])
    expect(updatesOf(writes, 'readings')).toEqual([{ on: 'readings', type: 'update', id: 'feb-11@policy', changes: { position: 'support', bearing: 'direct', via_question_id: null } }])
    expect(updatesOf(writes, 'stances')).toEqual([{ on: 'stances', type: 'update', id: 'policy:ann', changes: { position: 'support', summary: 'Now for it.', updated_at: NOW } }])
    expect(updatesOf(writes, 'proposal_items')[0].changes.act_id).toBe('feb-11')
    expect(onFile.readings[0].position).toBe('lean_support')
  })

  it('makes a reading its own once an editor reads the act on the parent directly', () => {
    const onFile = published({ acts: [act('signed', 'ann', { kind: 'commits' })], readings: [reading('signed', 'bill', 'support'), reading('signed', 'policy', 'support', 'bill')] })
    const writes = planReview(
      onFile,
      pending,
      article,
      { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'policy'), { act_id: 'signed', reading: 'mixed', position: 'mixed' })] },
      NOW,
      ids(),
    )
    expect(updatesOf(writes, 'readings')).toEqual([{ on: 'readings', type: 'update', id: 'signed@policy', changes: { position: 'mixed', bearing: 'direct', via_question_id: null } }])
  })

  it('records on the parent what the sub-question says doing it means, which need not be support', () => {
    const letter = question('letter', { parent_id: 'policy', kind: 'formal_act', implies_on_parent: 'oppose' })
    const writes = planReview(
      published({ questions: [policy, letter] }),
      pending,
      article,
      { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'letter'), { kind: 'commits' })] },
      NOW,
      ids(),
    )
    expect(rowsOf<Reading>(writes, 'readings').map((r) => [r.question_id, r.position, r.via_question_id])).toEqual([
      ['letter', 'support', null],
      ['policy', 'oppose', 'letter'],
    ])
    expect(rowsOf<Stance>(writes, 'stances').map((s) => [s.id, s.position])).toEqual([
      ['letter:ann', 'support'],
      ['policy:ann', 'oppose'],
    ])
  })

  it('keeps an indirect reading where it was made', () => {
    const writes = planReview(published(), pending, article, { source_title: article.title, review_note: null, items: [accept(item('i1', 'p1', 'ann', 'bill'), { kind: 'does', bearing: 'indirect' })] }, NOW, ids())
    expect(rowsOf<Reading>(writes, 'readings').map((r) => [r.question_id, r.bearing])).toEqual([['bill', 'indirect']])
    expect(updatesOf(writes, 'proposal_items')[0].changes.bearing).toBe('indirect')
  })

  it('rejects a whole proposal without publishing anything', () => {
    const writes = planReview(
      published(),
      pending,
      article,
      { source_title: article.title, review_note: 'Spam.', items: [{ item: item('i1', 'p1', 'ann', 'policy'), accept: false, comment: null }] },
      NOW,
      ids(),
    )
    expect(writes.map((w) => `${w.type} ${w.on}`)).toEqual(['update proposal_items', 'insert proposal_notes', 'update proposals'])
  })
})
