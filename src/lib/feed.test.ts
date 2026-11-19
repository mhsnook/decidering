import { describe, expect, it } from 'vitest'
import { buildFeed, buildWaiting, byDay, feedPage, questionFamily } from './feed.ts'
import { act, data, decider, item, proposal, question, reading, report, role, seat, source, track } from './fixtures.ts'

const at = (day: string) => `${day}T12:00:00.000Z`

const policy = question('policy')
const bill = question('bill', { parent_id: 'policy', kind: 'formal_act', implies_on_parent: 'support', sort: 1 })
const markup = question('markup', { parent_id: 'bill', sort: 2 })
const other = question('other', { sort: 3 })
const elsewhere = question('elsewhere', { body_id: 'council' })

const bodies = [
  ...data({}).bodies,
  { id: 'council', slug: 'council', name: 'Council', jurisdiction: null, description: null, is_demo: true, sort: 1, next_term_on: null, next_term_label: null },
]

const tracker = track({
  bodies,
  deciders: [decider('ann'), decider('bob'), decider('cy')],
  seats: [seat('s1'), seat('s2'), seat('c1', { body_id: 'council' })],
  roles: [role('s1', 'ann'), role('s2', 'bob'), role('c1', 'cy')],
  questions: [policy, bill, markup, other, elsewhere],
  sources: [source('paper'), source('release'), source('minutes')],
  acts: [
    act('cosponsor', 'ann', { kind: 'commits', occurred_on: '2026-03-01', created_at: at('2026-11-10'), primary_source_id: 'release' }),
    act('speech', 'bob', { occurred_on: '2026-11-01', created_at: at('2026-11-12') }),
    act('old-vote', 'bob', { kind: 'does', occurred_on: '2025-06-01', created_at: at('2026-11-12') }),
    act('aside', 'ann', { occurred_on: '2026-10-01', created_at: at('2026-11-14') }),
    act('council-vote', 'cy', { kind: 'does', occurred_on: '2026-09-01', created_at: at('2026-11-15') }),
    act('unread', 'ann', { created_at: at('2026-11-16') }),
  ],
  reports: [
    report('paper', 'cosponsor', { created_at: at('2026-11-09') }),
    report('release', 'cosponsor', { created_at: at('2026-11-10') }),
    report('paper', 'speech'),
    report('minutes', 'council-vote'),
  ],
  readings: [
    reading('cosponsor', 'bill', 'support'),
    reading('cosponsor', 'policy', 'support', 'bill'),
    reading('speech', 'policy', 'oppose'),
    reading('old-vote', 'markup', 'oppose'),
    reading('aside', 'other', 'mixed'),
    reading('council-vote', 'elsewhere', 'support'),
  ],
})

const ids = (entries: { act: { id: string } }[]) => entries.map((e) => e.act.id)

describe('the published feed', () => {
  const feed = buildFeed(tracker)

  it('lists each act once, newest into the record first, then by when it happened', () => {
    expect(ids(feed)).toEqual(['council-vote', 'aside', 'speech', 'old-vote', 'cosponsor'])
  })

  it('leaves out an act with no reading, which says nothing on any question', () => {
    expect(ids(feed)).not.toContain('unread')
  })

  it('says every question one act is read on, the direct reading before the implied one', () => {
    const cosponsor = feed.find((e) => e.act.id === 'cosponsor')!
    expect(cosponsor.readings.map((r) => [r.question.id, r.reading.position, r.via?.id])).toEqual([
      ['bill', 'support', undefined],
      ['policy', 'support', 'bill'],
    ])
  })

  it('lists the record of the act itself before the sources that report it', () => {
    expect(feed.find((e) => e.act.id === 'cosponsor')!.reports.map((r) => r.source.id)).toEqual(['release', 'paper'])
  })

  it('marks entries read on a question in a demo body', () => {
    expect(feed.filter((e) => e.isDemo).map((e) => e.act.id)).toEqual(['council-vote'])
  })
})

describe('filters', () => {
  it('takes a question and everything under it, at any depth', () => {
    expect([...questionFamily(tracker, 'policy')].sort()).toEqual(['bill', 'markup', 'policy'])
    expect(ids(buildFeed(tracker, { questionId: 'policy' }))).toEqual(['speech', 'old-vote', 'cosponsor'])
    expect(ids(buildFeed(tracker, { questionId: 'bill' }))).toEqual(['old-vote', 'cosponsor'])
    expect(ids(buildFeed(tracker, { questionId: 'markup' }))).toEqual(['old-vote'])
  })

  it('takes a body: people seated in it, on questions put to it', () => {
    expect(ids(buildFeed(tracker, { bodyId: 'council' }))).toEqual(['council-vote'])
    expect(ids(buildFeed(tracker, { bodyId: 'body' }))).toEqual(['aside', 'speech', 'old-vote', 'cosponsor'])
  })

  it('combines a question and a body', () => {
    expect(ids(buildFeed(tracker, { questionId: 'policy', bodyId: 'council' }))).toEqual([])
    expect(ids(buildFeed(tracker, { questionId: 'elsewhere', bodyId: 'council' }))).toEqual(['council-vote'])
  })
})

describe('paging', () => {
  const feed = buildFeed(tracker)

  it('starts at the newest and gives a cursor while more remain', () => {
    const first = feedPage(feed, undefined, 2)
    expect(ids(first.entries)).toEqual(['council-vote', 'aside'])
    expect(first.older).toBe('aside')
    expect(first.isFirst).toBe(true)
    const second = feedPage(feed, first.older, 2)
    expect(ids(second.entries)).toEqual(['speech', 'old-vote'])
    const last = feedPage(feed, second.older, 2)
    expect(ids(last.entries)).toEqual(['cosponsor'])
    expect(last.older).toBeUndefined()
    expect(last.isFirst).toBe(false)
  })

  it('goes back to the newest when the cursor is no longer in the feed', () => {
    expect(feedPage(feed, 'merged-away', 2).isFirst).toBe(true)
  })

  it('does not skip entries that entered at the same moment', () => {
    const seen = []
    let cursor: string | undefined
    do {
      const page = feedPage(feed, cursor, 1)
      seen.push(...ids(page.entries))
      cursor = page.older
    } while (cursor)
    expect(seen).toEqual(ids(feed))
  })

  it('groups consecutive entries by the day they entered', () => {
    expect(byDay(feed, (e) => e.enteredAt).map((d) => [d.day, ids(d.entries)])).toEqual([
      ['2026-11-15', ['council-vote']],
      ['2026-11-14', ['aside']],
      ['2026-11-12', ['speech', 'old-vote']],
      ['2026-11-10', ['cosponsor']],
    ])
  })
})

describe('what is waiting for review', () => {
  const proposals = [
    proposal('from-reader', 'paper', { created_at: at('2026-11-17') }),
    proposal('from-model', 'release', { origin: 'model', created_at: at('2026-11-18') }),
    proposal('lead', 'minutes', { origin: 'news_search', created_at: at('2026-11-18') }),
    proposal('done', 'paper', { status: 'reviewed', created_at: at('2026-11-01') }),
  ]
  const items = [
    item('claim', 'from-reader', 'ann', 'policy', { reading: 'support' }),
    item('turned-down', 'from-reader', 'bob', 'policy', { reading: 'oppose', status: 'rejected' }),
    item('on-bill', 'from-model', 'bob', 'bill', { reading: 'support', act_id: 'one-act', sort: 0 }),
    item('on-policy', 'from-model', 'bob', 'policy', { reading: 'support', act_id: 'one-act', sort: 1 }),
    item('second-act', 'from-model', 'bob', 'other', { reading: 'mixed', act_id: 'two' }),
    item('bare-lead', 'lead', 'cy', 'elsewhere'),
    item('published', 'done', 'ann', 'policy', { reading: 'support', status: 'accepted' }),
    item('unknown-person', 'from-reader', 'nobody', 'policy', { reading: 'support' }),
  ]
  const waiting = buildWaiting(tracker, proposals, items)
  const claimed = (entries: typeof waiting) => entries.map((e) => [e.proposal.id, e.claims.map((c) => c.item.id)])

  it('shows only pending items that claim a reading, newest proposal first', () => {
    expect(claimed(waiting)).toEqual([
      ['from-model', ['on-bill', 'on-policy']],
      ['from-model', ['second-act']],
      ['from-reader', ['claim']],
    ])
  })

  it('never shows a rejected item, a bare search lead or anything already reviewed', () => {
    const shown = waiting.flatMap((e) => e.claims.map((c) => c.item.id))
    for (const id of ['turned-down', 'bare-lead', 'published', 'unknown-person']) expect(shown).not.toContain(id)
  })

  it('takes the same filters as the record', () => {
    expect(claimed(buildWaiting(tracker, proposals, items, { questionId: 'bill' }))).toEqual([['from-model', ['on-bill']]])
    expect(claimed(buildWaiting(tracker, proposals, items, { bodyId: 'council' }))).toEqual([])
  })

  it('keeps who put it forward', () => {
    expect(waiting.map((e) => e.proposal.origin)).toEqual(['model', 'model', 'reader'])
  })
})
