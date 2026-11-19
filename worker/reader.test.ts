import { describe, expect, it } from 'vitest'
import { draftFromReading, findInArticle, MAX_ACTS_PER_ARTICLE, modelOutputSchema, modelPrompt, MODEL, quoteIsInArticle, readArticle, type ModelAct, type ReadingContext } from './reader.ts'

const ARTICLE = `Ann Alpha told reporters on Monday: “I will vote for this bill — and I’ll whip votes for it.”
The senator  from the north,
Bob Beta, did not comment.`

describe('quoteIsInArticle', () => {
  it('finds words copied from the article whatever the quote marks, dashes, case and line breaks', () => {
    expect(quoteIsInArticle('I will vote for this bill - and I\'ll whip votes for it.', ARTICLE)).toBe(true)
    expect(quoteIsInArticle('"i will vote for this bill"', ARTICLE)).toBe(true)
    expect(quoteIsInArticle('The senator from the north, Bob Beta, did not comment.', ARTICLE)).toBe(true)
  })

  it('turns away a paraphrase, an ellipsis, or an added word', () => {
    expect(quoteIsInArticle('I will support this bill', ARTICLE)).toBe(false)
    expect(quoteIsInArticle('I will vote for this bill … whip votes for it', ARTICLE)).toBe(false)
    expect(quoteIsInArticle('I will vote for this good bill', ARTICLE)).toBe(false)
  })

  it('turns away a quote too short to tell anything', () => {
    expect(quoteIsInArticle('I will', ARTICLE)).toBe(false)
  })
})

const act = (overrides: Partial<Record<keyof ModelAct, unknown>> = {}) => ({
  person_id: 'ann',
  question_id: 'hot',
  kind: 'says',
  quote: 'I will vote for this bill',
  occurred_on: '2026-11-16',
  position: 'support',
  bearing: 'direct',
  summary: 'Says she will vote for it.',
  reason: 'A direct statement of how she will vote.',
  ...overrides,
})

describe('findInArticle', () => {
  it('returns the article’s own words for a quote the model wrapped in curly quotes', () => {
    expect(findInArticle('“I will vote for this bill”', ARTICLE)).toBe('I will vote for this bill')
  })

  it('returns the article’s casing and punctuation, not the model’s', () => {
    expect(findInArticle("i will vote for this bill - and i'll whip votes", ARTICLE)).toBe('I will vote for this bill — and I’ll whip votes')
  })

  it('keeps an apostrophe that ends the quote', () => {
    const text = 'The vote rests with the committee members’ letter, sent on Friday.'
    expect(findInArticle("the committee members'", text)).toBe('the committee members’')
  })

  it('cuts the match out correctly after characters outside the basic plane', () => {
    const text = 'Reacting 😀😀 online, Ann Alpha wrote: I will vote for this bill.'
    expect(findInArticle('I will vote for this bill', text)).toBe('I will vote for this bill')
  })
})

describe('modelOutputSchema', () => {
  it('takes a well-formed answer', () => {
    expect(modelOutputSchema.parse({ acts: [act()] }).acts[0]).toMatchObject({ person_id: 'ann', occurred_on: '2026-11-16' })
  })

  it('turns a date it cannot read into no date rather than refusing the act', () => {
    expect(modelOutputSchema.parse({ acts: [act({ occurred_on: 'last Monday' })] }).acts[0].occurred_on).toBeNull()
    expect(modelOutputSchema.parse({ acts: [act({ occurred_on: '2026-02-30' })] }).acts[0].occurred_on).toBeNull()
  })

  it('refuses a kind, position or bearing outside the schema', () => {
    expect(modelOutputSchema.safeParse({ acts: [act({ kind: 'tweets' })] }).success).toBe(false)
    expect(modelOutputSchema.safeParse({ acts: [act({ position: 'strong_support' })] }).success).toBe(false)
    expect(modelOutputSchema.safeParse({ acts: [act({ bearing: 'sideways' })] }).success).toBe(false)
    expect(modelOutputSchema.safeParse({ result: [] }).success).toBe(false)
  })
})

describe('modelPrompt', () => {
  const context = { question: { id: 'hot', title: 'Hot question?', short_title: 'Hot', description: null, kind: 'position' as const }, subQuestions: [], people: [{ id: 'ann', name: 'Ann Alpha', questions: ['hot'] }] }
  const prompt = modelPrompt(context, { url: 'https://news.example/a', title: 'A', date: null, text: ARTICLE }, '2026-11-19')

  it('gives the model the people it may name and the whole article', () => {
    expect(prompt.messages[1].content).toContain('"person_id": "ann"')
    expect(prompt.messages[1].content).toContain(ARTICLE)
  })

  // The schema sent to the model and the one its answer is checked against are
  // written separately; an answer the first allows must not fail the second.
  it('asks for the same fields and values that modelOutputSchema checks', () => {
    const sent = (prompt.response_format.json_schema.schema as unknown as { properties: { acts: { items: { properties: Record<string, { enum?: string[] }>; required: string[] } } } }).properties.acts.items
    const checked = modelOutputSchema.shape.acts.element.shape
    expect([...sent.required].sort()).toEqual(Object.keys(checked).sort())
    for (const [field, spec] of Object.entries(sent.properties)) {
      const zodField = checked[field as keyof typeof checked] as unknown as { options?: readonly string[] }
      if (spec.enum) expect(spec.enum).toEqual(zodField.options)
    }
    const sample = Object.fromEntries(Object.entries(sent.properties).map(([field, spec]) => [field, spec.enum ? spec.enum[0] : field === 'occurred_on' ? null : 'text']))
    expect(modelOutputSchema.safeParse({ acts: [sample] }).success).toBe(true)
  })
})

const context: ReadingContext = {
  question: { id: 'hot', title: 'Hot question?', short_title: 'Hot', description: null, kind: 'position' },
  subQuestions: Array.from({ length: 12 }, (_, i) => ({ id: `sub-${i}`, title: `Sub ${i}?`, short_title: `Sub ${i}`, description: null, kind: 'position' as const, is_ask: false })),
  people: [{ id: 'ann', name: 'Ann Alpha', questions: ['hot', ...Array.from({ length: 12 }, (_, i) => `sub-${i}`)] }],
}
const answering = (answer: unknown) => ({ AI: { run: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }, AI_GATEWAY: 'gw' }) as unknown as Env
const read = (answer: unknown, text = ARTICLE) => readArticle(answering(answer), context, { url: 'https://news.example/a', title: null, date: null, text }, '2026-11-19')

describe('readArticle', () => {
  it('keeps one act per person and question when the model repeats itself', async () => {
    const reading = await read({ acts: [act(), act(), act({ quote: 'whip votes for it' })] })
    expect(reading.ok && reading.acts).toHaveLength(1)
    expect(reading.ok && reading.dropped.map((d) => d.why)).toEqual(['repeats a person and question already listed', 'repeats a person and question already listed'])
  })

  it('keeps no more than MAX_ACTS_PER_ARTICLE acts from one article', async () => {
    const reading = await read({ acts: Array.from({ length: 12 }, (_, i) => act({ question_id: `sub-${i}` })) })
    expect(reading.ok && reading.acts).toHaveLength(MAX_ACTS_PER_ARTICLE)
    expect(reading.ok && reading.dropped).toHaveLength(12 - MAX_ACTS_PER_ARTICLE)
  })

  it('cuts an overlong quote, summary and reason to the lengths the review form takes', async () => {
    const long = 'I will vote for this bill '.repeat(200)
    const reading = await read({ acts: [act({ quote: long, summary: 'x'.repeat(5000), reason: 'y'.repeat(5000) })] }, long)
    expect(reading.ok).toBe(true)
    const [kept] = reading.ok ? reading.acts : []
    expect(kept.quote.length).toBeLessThanOrEqual(2000)
    expect(kept.summary.length).toBeLessThanOrEqual(300)
    expect(kept.reason.length).toBeLessThanOrEqual(1000)
  })
})

describe('readArticle dates', () => {
  it('drops a date after today, which is a date promised rather than the date of the act', async () => {
    const reading = await read({ acts: [act({ occurred_on: '2026-12-03' })] })
    expect(reading.ok && reading.acts[0].occurred_on).toBeNull()
  })

  it('keeps a date on or before today', async () => {
    const reading = await read({ acts: [act({ occurred_on: '2026-11-19' })] })
    expect(reading.ok && reading.acts[0].occurred_on).toBe('2026-11-19')
  })
})

describe('draftFromReading', () => {
  it('makes one proposal with an item per act, the reason in each item note, and the model in the proposal note', () => {
    const acts = modelOutputSchema.parse({ acts: [act(), act({ person_id: 'bob', kind: 'does', bearing: 'indirect' })] }).acts
    const draft = draftFromReading({ url: 'https://news.example/a', title: 'A' }, acts, [{ act: { person_id: 'ann', question_id: 'hot', quote: 'made up' }, why: 'quotes words that are not in the article' }], 'q')
    expect(draft.items).toMatchObject([
      { decider_id: 'ann', kind: 'says', reading: 'support', bearing: 'direct', note: expect.stringContaining('A direct statement of how she will vote.') },
      { decider_id: 'bob', kind: 'does', bearing: 'indirect' },
    ])
    expect(draft.note).toContain(MODEL)
    expect(draft.note).toContain('made up')
  })

  it('keeps the note short however many acts were dropped', () => {
    const dropped = Array.from({ length: 300 }, (_, i) => ({ act: { person_id: 'ann', question_id: 'hot', quote: `made up ${i} `.repeat(20) }, why: 'quotes words that are not in the article' }))
    const draft = draftFromReading({ url: 'https://news.example/a', title: 'A' }, [], dropped, 'q')
    expect(draft.note!.length).toBeLessThan(1000)
    expect(draft.note).toContain('300')
  })
})
