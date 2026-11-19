import { describe, expect, it } from 'vitest'
import { draftFromReading, modelOutputSchema, modelPrompt, MODEL, quoteIsInArticle, type ModelAct } from './reader.ts'

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
  it('asks for JSON in the schema, without reasoning', () => {
    const prompt = modelPrompt(
      { question: { id: 'hot', title: 'Hot question?', short_title: 'Hot', description: null, kind: 'position' }, subQuestions: [], people: [{ id: 'ann', name: 'Ann Alpha', questions: ['hot'] }] },
      { url: 'https://news.example/a', title: 'A', date: null, text: ARTICLE },
      '2026-11-19',
    )
    expect(prompt.response_format.type).toBe('json_schema')
    expect(prompt.response_format.json_schema.schema).toMatchObject({ type: 'object', required: ['acts'], additionalProperties: false })
    expect(prompt.reasoning_effort).toBe('none')
    expect(prompt.messages[1].content).toContain('"person_id": "ann"')
    expect(prompt.messages[1].content).toContain(ARTICLE)
  })
})

describe('draftFromReading', () => {
  it('makes one proposal with an item per act, the reason in each item note, and the model in the proposal note', () => {
    const acts = [modelOutputSchema.parse({ acts: [act(), act({ person_id: 'bob', kind: 'does', bearing: 'indirect' })] }).acts].flat()
    const draft = draftFromReading({ url: 'https://news.example/a', title: 'A' }, acts, [{ act: { person_id: 'ann', question_id: 'hot', quote: 'made up' }, why: 'quotes words that are not in the article' }], 'q')
    expect(draft.items).toMatchObject([
      { decider_id: 'ann', kind: 'says', reading: 'support', bearing: 'direct', note: "Model's reason: A direct statement of how she will vote." },
      { decider_id: 'bob', kind: 'does', bearing: 'indirect' },
    ])
    expect(draft.note).toContain(MODEL)
    expect(draft.note).toContain('1 more act was left out: "made up" quotes words that are not in the article.')
    expect(draft.note).toContain('Found by searching: q')
  })
})
