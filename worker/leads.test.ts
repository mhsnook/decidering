import { describe, expect, it } from 'vitest'
import { leadsFromHit, rosterMatcher } from './leads.ts'

const roster = [
  { id: 'jayapal', name: 'Pramila Jayapal', sort_name: 'Jayapal, Pramila' },
  { id: 'barragan', name: 'Nanette Diaz Barragán', sort_name: 'Barragán, Nanette' },
  { id: 'adams', name: 'Alma S. Adams', sort_name: 'Adams, Alma' },
  { id: 'smith-a', name: 'Adam Smith', sort_name: 'Smith, Adam' },
  { id: 'smith-j', name: 'Jason Smith', sort_name: 'Smith, Jason' },
]
const match = rosterMatcher(roster)

describe('rosterMatcher', () => {
  it('matches a full name, with or without a middle name or accents', () => {
    expect(match('Today Pramila Jayapal said the bill would pass')).toEqual(['jayapal'])
    expect(match('Nanette Diaz Barragan signs on')).toEqual(['barragan'])
    expect(match('Alma Adams and Alma S. Adams are one person')).toEqual(['adams'])
  })

  it('matches a titled last name only when the last name is unique', () => {
    expect(match('Rep. Jayapal reintroduces the bill')).toEqual(['jayapal'])
    expect(match('Rep. Smith reintroduces the bill')).toEqual([])
    expect(match('Jason Smith reintroduces the bill')).toEqual(['smith-j'])
  })

  it('does not match a name split across unrelated words', () => {
    expect(match('Alma mater of the late John Quincy Adams')).toEqual([])
  })
})

describe('leadsFromHit', () => {
  const hit = { url: 'https://example.com/a', title: 'Rep. Jayapal on single payer', description: 'Pramila Jayapal said she would reintroduce it.', lastModifiedDate: '2026-11-02T10:00:00' }

  it('turns a hit into a lead with no position and the page date', () => {
    expect(leadsFromHit(hit, 'q', 'query', match)).toMatchObject([{ decider_id: 'jayapal', signals: null, occurred_on: '2026-11-02', source_url: 'https://example.com/a' }])
  })

  it('drops hits that name nobody, or name a crowd', () => {
    expect(leadsFromHit({ ...hit, title: 'Health policy news', description: 'Nothing about anyone in particular.' }, 'q', 'query', match)).toEqual([])
    const crowd = 'Pramila Jayapal, Alma Adams, Adam Smith and Jason Smith all spoke.'
    expect(leadsFromHit({ ...hit, description: crowd }, 'q', 'query', match)).toEqual([])
  })
})
