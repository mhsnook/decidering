import { describe, expect, it } from 'vitest'
import type { PositionDecision } from './review-plan.ts'
import { addedEntry, decisionOf, draftEntries, fallbackDate, missingFrom, outlook, relatedChoices, verdictOf, withWeight, type EntryDraft } from './review-form.ts'
import { act, decider, item, link, proposal, question, reading, relation, role, seat, setPosition, source, track } from './fixtures.ts'

const FALLBACK = '2026-11-12'

// An entry ready to publish: one reader's item with both answers and a date.
const ready = (over: Partial<EntryDraft> = {}): EntryDraft => ({
  ...draftEntries([item('i1', 'p1', 'ann', 'policy', { reading: 'support', weight: 'clear', occurred_on: '2026-11-10' })], FALLBACK)[0],
  ...over,
})

describe('draftEntries', () => {
  it('makes one entry of items that share an act and a person, read on the first item’s question and on the others beside it', () => {
    const items = [
      item('on-markup', 'p1', 'ann', 'markup', { act_id: 'shared', sort: 2, reading: 'lean_support', weight: 'clear' }),
      item('bob', 'p1', 'bob', 'policy', { sort: 1, reading: 'oppose', weight: 'clear' }),
      item('on-policy', 'p1', 'ann', 'policy', { act_id: 'shared', sort: 0, reading: 'support', weight: 'concrete', kind: 'does', passage: 'The paragraph.' }),
    ]
    const drafts = draftEntries(items, FALLBACK)
    expect(drafts.map((d) => [d.decider_id, d.act_id, d.items.map((i) => i.id)])).toEqual([
      ['ann', 'shared', ['on-policy', 'on-markup']],
      ['bob', 'act-of-bob', ['bob']],
    ])
    expect(drafts[0]).toMatchObject({ question_id: 'policy', kind: 'does', reading: 'support', weight: 'concrete', passage: 'The paragraph.', contextItemId: 'on-policy', related: { markup: 'lean_support' }, dismissed: false })
    expect(drafts[1].related).toEqual({})
  })

  it('keeps two people apart when their items name the same act', () => {
    const drafts = draftEntries([item('i1', 'p1', 'ann', 'policy', { act_id: 'same' }), item('i2', 'p1', 'bob', 'policy', { act_id: 'same', sort: 1 })], FALLBACK)
    expect(drafts.map((d) => d.decider_id)).toEqual(['ann', 'bob'])
    expect(new Set(drafts.map((d) => d.key)).size).toBe(2)
  })

  it('starts a search lead with no words and no answers, since its excerpt is nobody’s words', () => {
    const [lead] = draftEntries([item('lead', 'p1', 'ann', 'policy', { quote: 'A search excerpt naming Ann.' })], FALLBACK)
    expect(lead).toMatchObject({ quote: '', reading: null, weight: null })
  })

  it('keeps the words of an item that claims a reading, and of one read from an article', () => {
    const [claimed] = draftEntries([item('i1', 'p1', 'ann', 'policy', { reading: 'support', weight: 'clear', quote: 'I am for it.' })], FALLBACK)
    expect(claimed.quote).toBe('I am for it.')
    const [read] = draftEntries([item('i1', 'p1', 'ann', 'policy', { quote: 'I am for it.', passage: 'She said: I am for it.' })], FALLBACK)
    expect(read.quote).toBe('I am for it.')
  })

  it('assumes the fallback date for an item with none, and says it did', () => {
    const [dated, undated] = draftEntries([item('i1', 'p1', 'ann', 'policy', { occurred_on: '2026-11-01' }), item('i2', 'p1', 'bob', 'policy', { sort: 1 })], FALLBACK)
    expect([dated.occurred_on, dated.dateAssumed]).toEqual(['2026-11-01', false])
    expect([undated.occurred_on, undated.dateAssumed]).toEqual([FALLBACK, true])
  })

  it('counts an entry as dismissed only when every one of its items was rejected, and leaves a rejected reading out', () => {
    const rejected = { status: 'rejected' as const, reading: 'support' as const }
    const [all, some] = draftEntries(
      [
        item('a1', 'p1', 'ann', 'policy', { act_id: 'a', sort: 0, ...rejected }),
        item('a2', 'p1', 'ann', 'markup', { act_id: 'a', sort: 1, ...rejected }),
        item('b1', 'p1', 'bob', 'policy', { act_id: 'b', sort: 2, reading: 'oppose' }),
        item('b2', 'p1', 'bob', 'markup', { act_id: 'b', sort: 3, ...rejected }),
      ],
      FALLBACK,
    )
    expect([all.dismissed, all.related]).toEqual([true, {}])
    expect([some.dismissed, some.related]).toEqual([false, {}])
  })

  it('starts every entry with no note, no position to set and a set position kept', () => {
    expect(ready()).toMatchObject({ note: '', copiedFrom: null, setPosition: null, decision: { action: 'keep', position: null, reason: '' } })
  })
})

describe('addedEntry', () => {
  const ids = () => {
    let n = 0
    return () => `new-${++n}`
  }
  const first = ready({ passage: 'The paragraph.', related: { markup: 'lean_support' }, note: 'A note about Ann.', dismissed: true, setPosition: { position: 'support', reason: 'r' }, decision: { action: 'lift', position: null, reason: 'x' } })
  const added = addedEntry(first, 'Ann', ids())

  it('starts from the first entry’s answers, date and passage', () => {
    expect(added).toMatchObject({ question_id: 'policy', kind: 'says', occurred_on: '2026-11-10', reading: 'support', weight: 'clear', passage: 'The paragraph.', related: { markup: 'lean_support' }, copiedFrom: 'Ann' })
  })

  it('is a new act by nobody yet, with no words, no items and nothing decided', () => {
    expect(added).toMatchObject({ decider_id: null, items: [], quote: '', note: '', dismissed: false, setPosition: null, decision: { action: 'keep', position: null, reason: '' } })
    expect(added.act_id).not.toBe(first.act_id)
    expect(added.key).not.toBe(first.key)
    expect(added.key).not.toBe(added.act_id)
  })

  it('has its own readings on other questions, so changing them leaves the first entry alone', () => {
    added.related.markup = null
    expect(first.related).toEqual({ markup: 'lean_support' })
  })
})

describe('withWeight', () => {
  it('turns words into a use of office when they are read as concrete', () => {
    expect(withWeight(ready(), 'concrete')).toMatchObject({ weight: 'concrete', kind: 'does' })
  })

  it('leaves a commitment a commitment', () => {
    expect(withWeight(ready({ kind: 'commits' }), 'concrete')).toMatchObject({ weight: 'concrete', kind: 'commits' })
  })

  it('leaves the kind alone for any other weight', () => {
    expect(withWeight(ready(), 'passing')).toMatchObject({ weight: 'passing', kind: 'says' })
    expect(withWeight(ready({ kind: 'does', weight: 'concrete' }), 'clear')).toMatchObject({ weight: 'clear', kind: 'does' })
  })
})

describe('missingFrom', () => {
  it('is null for an entry with a person, words, both answers and a date', () => {
    expect(missingFrom(ready())).toBeNull()
  })

  it('names the one thing an entry lacks', () => {
    expect(missingFrom(ready({ decider_id: null }))).toBe('the person')
    expect(missingFrom(ready({ quote: '  \n ' }))).toBe('the words')
    expect(missingFrom(ready({ reading: null }))).toBe('both answers')
    expect(missingFrom(ready({ weight: null }))).toBe('both answers')
    expect(missingFrom(ready({ occurred_on: '' }))).toBe('the date')
  })

  it('names the person first, then the words, then the answers, then the date', () => {
    const empty = ready({ decider_id: null, quote: '', reading: null, weight: null, occurred_on: '' })
    expect(missingFrom(empty)).toBe('the person')
    expect(missingFrom({ ...empty, decider_id: 'ann' })).toBe('the words')
    expect(missingFrom({ ...empty, decider_id: 'ann', quote: 'Words.' })).toBe('both answers')
    expect(missingFrom({ ...empty, decider_id: 'ann', quote: 'Words.', reading: 'support', weight: 'clear' })).toBe('the date')
  })
})

describe('outlook', () => {
  const policy = question('policy')
  const bill = question('bill', { parent_id: 'policy', kind: 'formal_act' })
  const set = setPosition('policy', 'bob', 'support', 'Promised it at the convention.')
  const tracker = track({
    deciders: [decider('ann'), decider('bob')],
    questions: [policy, bill],
    acts: [act('speech', 'ann', { occurred_on: '2026-02-01' }), act('vote', 'ann', { kind: 'does', occurred_on: '2026-03-01' })],
    readings: [reading('speech', 'policy', 'lean_support')],
    setPositions: [set],
  })
  const entry = (over: Partial<EntryDraft> = {}) => ready({ act_id: 'new-act', ...over })

  it('says where the person is listed now and where publishing the entry would leave them', () => {
    const view = outlook(tracker, entry({ reading: 'oppose' }), policy, 'oppose')
    expect(view.now).toMatchObject({ standing: 'lean_support', calculated: 'lean_support', set: undefined })
    expect(view.then).toMatchObject({ standing: 'oppose', calculated: 'oppose' })
    expect(view.across).toBeUndefined()
  })

  it('weighs the entry as the form has it', () => {
    expect(outlook(tracker, entry({ weight: 'passing' }), policy, 'oppose').then?.standing).toBe('lean_support')
    expect(outlook(tracker, entry({ weight: 'concrete', kind: 'does', occurred_on: '2026-01-01' }), policy, 'oppose').then?.standing).toBe('lean_oppose')
  })

  it('has nothing to say about afterwards until the entry has a person, a reading and a weight', () => {
    for (const view of [outlook(tracker, entry(), policy, null), outlook(tracker, entry({ weight: null }), policy, 'oppose'), outlook(tracker, entry({ decider_id: null }), policy, 'oppose')]) {
      expect([view.then, view.across]).toEqual([null, undefined])
    }
    expect(outlook(tracker, entry({ decider_id: null }), policy, 'oppose').now.standing).toBe('unknown')
  })

  it('reports the position editors set when the reading sits across from it, which stays shown', () => {
    const view = outlook(tracker, entry({ decider_id: 'bob' }), policy, 'oppose')
    expect(view.across).toEqual(set)
    expect(view.now).toMatchObject({ standing: 'support', calculated: 'unknown', set })
    expect(view.then).toMatchObject({ standing: 'support', calculated: 'oppose', set })
  })

  it('reports nothing across for a reading on the same side as the set position, or a mixed one', () => {
    expect(outlook(tracker, entry({ decider_id: 'bob' }), policy, 'lean_support').across).toBeUndefined()
    expect(outlook(tracker, entry({ decider_id: 'bob' }), policy, 'mixed').across).toBeUndefined()
  })

  it('leaves the person where they are for an act already read on the question', () => {
    const view = outlook(tracker, entry({ act_id: 'speech' }), policy, 'oppose')
    expect(view.then).toEqual(view.now)
  })

  it('goes by the act on file, not the form, when the entry names one', () => {
    const view = outlook(tracker, entry({ act_id: 'vote', kind: 'says', weight: 'concrete', occurred_on: '2020-01-01' }), bill, 'support')
    expect(view.then?.standing).toBe('support')
  })

  it('reads a formal-act question off the entry only when it is a concrete commitment or use of office', () => {
    expect(outlook(tracker, entry({ kind: 'commits', weight: 'concrete' }), bill, 'support').then?.standing).toBe('support')
    expect(outlook(tracker, entry({ kind: 'says', weight: 'concrete' }), bill, 'support').then?.standing).toBe('unknown')
    expect(outlook(tracker, entry({ kind: 'commits', weight: 'clear' }), bill, 'support').then?.standing).toBe('unknown')
  })
})

describe('relatedChoices', () => {
  const policy = question('policy')
  const tracker = track({
    deciders: [decider('ann'), decider('bob')],
    seats: [seat('h1', { chamber: 'House' }), seat('s1', { chamber: 'Senate' })],
    roles: [role('h1', 'ann'), role('s1', 'bob')],
    questions: [
      policy,
      question('bill', { parent_id: 'policy', kind: 'formal_act', sort: 1 }),
      question('house-bill', { parent_id: 'policy', kind: 'formal_act', chamber: 'House', sort: 2 }),
      question('senate-bill', { parent_id: 'policy', kind: 'formal_act', chamber: 'Senate', sort: 3 }),
      question('old-bill', { parent_id: 'policy', kind: 'formal_act', status: 'lapsed', closed_on: '2025-01-03', sort: 4 }),
      question('hearing', { parent_id: 'policy', sort: 5 }),
      question('markup', { parent_id: 'policy', sort: 6 }),
      question('step'),
      question('near-bill'),
      question('closed-step', { status: 'resolved', closed_on: '2025-01-03' }),
    ],
    questionDeciders: [link('hearing', 'ann'), link('markup', 'bob')],
    questionRelations: [
      relation('policy', 'step', 'smaller_step'),
      relation('policy', 'closed-step', 'smaller_step', 1),
      relation('policy', 'bill', 'related'),
      relation('policy', 'markup', 'related', 1),
      relation('near-bill', 'bill', 'related'),
    ],
  })
  const choices = (over: Partial<EntryDraft>) => relatedChoices(tracker, ready(over)).map((c) => [c.question.id, c.kind])

  it('offers the rest of the question’s family that is put to the person, then the questions linked to it', () => {
    expect(choices({ question_id: 'bill' })).toEqual([
      ['policy', 'main_question'],
      ['house-bill', 'measure'],
      ['hearing', 'ask'],
      ['step', 'smaller_step'],
      ['near-bill', 'related'],
    ])
  })

  it('offers no main question for an entry read on the main question, and each question once', () => {
    expect(choices({ question_id: 'policy' })).toEqual([
      ['bill', 'measure'],
      ['house-bill', 'measure'],
      ['hearing', 'ask'],
      ['step', 'smaller_step'],
    ])
  })

  it('goes by the person: their chamber’s measures and the asks put to them', () => {
    expect(choices({ question_id: 'policy', decider_id: 'bob' })).toEqual([
      ['bill', 'measure'],
      ['senate-bill', 'measure'],
      ['markup', 'ask'],
      ['step', 'smaller_step'],
    ])
  })

  it('never offers a closed question, the entry’s own question, or an ask put to someone else', () => {
    const offered = [...choices({ question_id: 'bill' }), ...choices({ question_id: 'policy' })].map(([id]) => id)
    for (const id of ['old-bill', 'closed-step', 'senate-bill', 'markup']) expect(offered).not.toContain(id)
    expect(choices({ question_id: 'bill' }).map(([id]) => id)).not.toContain('bill')
  })

  it('offers nothing until the entry has a person, or for a question that is not on file', () => {
    expect(choices({ decider_id: null })).toEqual([])
    expect(choices({ question_id: 'gone' })).toEqual([])
  })
})

describe('verdictOf', () => {
  const onPolicy = item('on-policy', 'p1', 'ann', 'policy', { act_id: 'shared', reading: 'support', weight: 'clear', occurred_on: '2026-11-10', passage: 'The paragraph.' })
  const onMarkup = item('on-markup', 'p1', 'ann', 'markup', { act_id: 'shared', sort: 1, reading: 'lean_support', weight: 'clear' })
  const [two] = draftEntries([onPolicy, onMarkup], FALLBACK)

  it('gives a published entry as the plan takes it, with a reading for each question answered', () => {
    const draft = { ...two, quote: '  I am for it.  ', note: ' Checked. ', related: { markup: 'lean_support' as const, bill: 'support' as const, hearing: null } }
    expect(verdictOf([draft], '  Read in full. ')).toEqual({
      review_note: 'Read in full.',
      entries: [
        {
          decider_id: 'ann',
          items: [onPolicy, onMarkup],
          note: 'Checked.',
          publish: true,
          act_id: 'shared',
          kind: 'says',
          occurred_on: '2026-11-10',
          quote: 'I am for it.',
          passage: 'The paragraph.',
          weight: 'clear',
          readings: [
            { question_id: 'policy', reading: 'support', item: onPolicy },
            { question_id: 'markup', reading: 'lean_support', item: onMarkup },
            { question_id: 'bill', reading: 'support', item: null },
          ],
          decision: null,
        },
      ],
    })
  })

  it('leaves out a reading the editor set to none, so the plan rejects its item', () => {
    const [entry] = verdictOf([{ ...two, related: { markup: null } }], '').entries
    expect(entry.publish && entry.readings.map((r) => r.question_id)).toEqual(['policy'])
    expect(entry.items).toEqual([onPolicy, onMarkup])
  })

  it('gives no review note and no entry note when they are blank', () => {
    const { review_note, entries } = verdictOf([{ ...two, note: '  ' }], ' \n')
    expect([review_note, entries[0].note]).toEqual([null, null])
  })

  it('throws when an entry to publish is missing something, naming it', () => {
    expect(() => verdictOf([ready({ quote: '' })], '')).toThrow('An entry still needs the words.')
    expect(() => verdictOf([ready({ weight: null })], '')).toThrow('An entry still needs both answers.')
    expect(() => verdictOf([ready(), ready({ decider_id: null, items: [] })], '')).toThrow('An entry still needs the person.')
  })

  it('gives a dismissed entry as dismissed, whatever it is missing', () => {
    const lead = item('lead', 'p1', 'bob', 'policy')
    const [draft] = draftEntries([lead], FALLBACK)
    expect(verdictOf([{ ...draft, dismissed: true, note: 'Not about this.' }], '').entries).toEqual([{ decider_id: 'bob', items: [lead], note: 'Not about this.', publish: false }])
  })

  it('drops a dismissed entry the editor added, which has no item to reject', () => {
    const added = addedEntry(ready(), 'Ann')
    expect(verdictOf([ready(), { ...added, dismissed: true }], '').entries).toHaveLength(1)
  })

  it('dismisses every entry when asked to, complete or not', () => {
    const lead = draftEntries([item('lead', 'p1', 'bob', 'policy', { sort: 1 })], FALLBACK)[0]
    const { entries } = verdictOf([ready(), lead], 'Spam.', undefined, true)
    expect(entries.map((e) => [e.decider_id, e.publish])).toEqual([
      ['ann', false],
      ['bob', false],
    ])
  })

  it('sets a position the editor asked for on the entry’s question, with its reason trimmed', () => {
    const [entry] = verdictOf([ready({ setPosition: { position: 'lean_support', reason: ' Told the caucus. ' } })], '').entries
    expect(entry.publish && entry.decision).toEqual({ question_id: 'policy', action: 'set', position: 'lean_support', reason: 'Told the caucus.' })
  })

  it('throws when a position set by hand has no reason', () => {
    expect(() => verdictOf([ready({ setPosition: { position: 'lean_support', reason: '   ' } })], '')).toThrow(/needs its reason/)
    const decide = (): PositionDecision => ({ question_id: 'policy', action: 'set', position: 'oppose', reason: '' })
    expect(() => verdictOf([ready()], '', decide)).toThrow(/needs its reason/)
  })

  it('takes the decision on a position already set over one asked for on the entry', () => {
    const keep: PositionDecision = { question_id: 'policy', action: 'keep', reason: null }
    const [entry] = verdictOf([ready({ setPosition: { position: 'lean_support', reason: 'Told the caucus.' } })], '', () => keep).entries
    expect(entry.publish && entry.decision).toEqual(keep)
  })

  it('asks for no decision on a dismissed entry', () => {
    const asked: string[] = []
    verdictOf([ready({ dismissed: true })], '', (entry) => {
      asked.push(entry.key)
      return null
    })
    expect(asked).toEqual([])
  })
})

describe('decisionOf', () => {
  const across = (decision: EntryDraft['decision']) => decisionOf(ready({ question_id: 'markup', decision }), 'oppose')

  it('sets the position chosen, or the one the entry points to when none was chosen', () => {
    expect(across({ action: 'set', position: 'lean_oppose', reason: ' Said so twice. ' })).toEqual({ question_id: 'markup', action: 'set', position: 'lean_oppose', reason: 'Said so twice.' })
    expect(across({ action: 'set', position: null, reason: 'Said so twice.' })).toMatchObject({ action: 'set', position: 'oppose' })
  })

  it('keeps the set position, with a new reason only when one was typed', () => {
    expect(across({ action: 'keep', position: null, reason: '' })).toEqual({ question_id: 'markup', action: 'keep', reason: null })
    expect(across({ action: 'keep', position: null, reason: ' Still promised. ' })).toEqual({ question_id: 'markup', action: 'keep', reason: 'Still promised.' })
  })

  it('lifts the set position, with what was typed as a note', () => {
    expect(across({ action: 'lift', position: null, reason: '  ' })).toEqual({ question_id: 'markup', action: 'lift', note: null })
    expect(across({ action: 'lift', position: null, reason: 'The vote settles it.' })).toEqual({ question_id: 'markup', action: 'lift', note: 'The vote settles it.' })
  })
})

describe('fallbackDate', () => {
  const put = proposal('p1', 'article', { created_at: '2026-11-17T23:30:00.000Z' })

  it('is the day the source was published when that is known', () => {
    expect(fallbackDate(put, source('article', { published_on: '2026-11-03' }))).toBe('2026-11-03')
  })

  it('is the day the proposal was put forward otherwise', () => {
    expect(fallbackDate(put, source('article'))).toBe('2026-11-17')
    expect(fallbackDate(put, undefined)).toBe('2026-11-17')
  })
})
