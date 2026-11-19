import type { ProposalDraft } from '../shared/schema.ts'

export type RosterEntry = { id: string; name: string; sort_name: string }
export type SearchHit = { url: string; title: string; description?: string; lastModifiedDate?: string }

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Finds roster members named in a piece of text. A person matches on first name
// then last name with at most a middle name between them; a bare last name only
// counts when nobody else on the roster shares it.
export function rosterMatcher(roster: RosterEntry[]): (text: string) => string[] {
  const parsed = roster.map((r) => {
    const [last, rest = ''] = r.sort_name.split(',')
    return { id: r.id, last: fold(last.trim()), first: fold(rest.trim().split(/\s+/)[0] ?? '') }
  })
  const lastCount = new Map<string, number>()
  for (const p of parsed) lastCount.set(p.last, (lastCount.get(p.last) ?? 0) + 1)

  const patterns = parsed
    .filter((p) => p.first && p.last)
    .map((p) => ({
      id: p.id,
      full: new RegExp(`\\b${escape(p.first)}\\b(?:\\s+\\S+){0,2}?\\s+${escape(p.last)}\\b`),
      titled: lastCount.get(p.last) === 1 ? new RegExp(`\\b(?:rep|sen|senator|representative|councilmember|councillor|mayor|governor)\\.?\\s+${escape(p.last)}\\b`) : null,
    }))

  return (text) => {
    const haystack = fold(text)
    return patterns.filter((p) => p.full.test(haystack) || p.titled?.test(haystack)).map((p) => p.id)
  }
}

const MAX_PEOPLE_PER_HIT = 3

// A hit that names more people than this is a roundup, which is no one's statement.
// One hit is one proposal, with an item for each person it names.
export function leadFromHit(hit: SearchHit, questionId: string, query: string, match: (text: string) => string[]): ProposalDraft | null {
  if (!/^https?:\/\//.test(hit.url)) return null
  const quote = (hit.description ?? hit.title).trim().slice(0, 2000)
  if (quote.length < 10) return null
  const people = match(`${hit.title}\n${hit.description ?? ''}`)
  if (people.length === 0 || people.length > MAX_PEOPLE_PER_HIT) return null
  const date = hit.lastModifiedDate?.slice(0, 10)
  const occurred_on = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  return {
    source: { url: hit.url, title: hit.title.slice(0, 300) || null },
    note: `Search excerpt, not a verified quote. Found by searching: ${query}`,
    items: people.map((decider_id) => ({ question_id: questionId, decider_id, kind: 'statement', occurred_on, quote, reading: null })),
  }
}
