// Turns seed/data/*.json into seed/out/seed.sql. Seeding writes rows directly,
// which skips the sync log: run it before anyone is connected (a page reload
// picks the rows up from the snapshot).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../seed/data/${name}`, import.meta.url), 'utf8'))
const congress = read('us-congress.json')
const demo = read('demo.json')

const lines: string[] = []
const sql = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replaceAll("'", "''")}'`
function insert(table: string, row: Record<string, unknown>) {
  lines.push(`INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(sql).join(', ')});`)
}

const slugs = new Set<string>()
function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  let slug = base
  for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`
  slugs.add(slug)
  return slug
}

// ---- US Congress: real roster, real cosponsor records ----------------------

const US = 'us-congress'
insert('bodies', {
  id: US,
  slug: US,
  name: 'United States Congress',
  jurisdiction: 'United States',
  description: `Members of the 119th Congress. Roster and cosponsor records as of ${congress.fetched_on}.`,
  is_demo: false,
  sort: 0,
})

const members = new Map<string, any>()
for (const m of congress.members) {
  members.set(m.bioguide, m)
  insert('deciders', { id: m.bioguide, slug: slugify(m.name), name: m.name, sort_name: m.sort_name, external_id: m.bioguide, url: m.url })
  const house = m.chamber === 'House'
  const district = m.district === 0 ? 'AL' : m.district
  const seatId = house ? `${US}:${m.state}-${district}` : `${US}:${m.state}-sen-${m.senate_class}`
  insert('seats', {
    id: seatId,
    body_id: US,
    chamber: m.chamber,
    region: m.state,
    label: house ? `${m.state}-${district}` : `${m.state} Senate`,
    is_voting: m.voting,
    next_election_on: null,
  })
  insert('roles', { id: `${seatId}:${m.bioguide}`, seat_id: seatId, decider_id: m.bioguide, kind: 'incumbent', contest: null, affiliation: m.party })
}

insert('questions', {
  id: 'm4a',
  slug: 'medicare-for-all',
  body_id: US,
  parent_id: null,
  kind: 'position',
  title: 'Do they support Medicare for All?',
  short_title: 'Medicare for All',
  description: 'A single public insurance program that covers everyone, replacing most private coverage. This asks about the policy in general; the measures below ask about specific bills.',
  reference_url: null,
  chamber: null,
  is_hot: true,
  sort: 0,
})

let skipped = 0
congress.bills.forEach((bill: any, i: number) => {
  const qid = `m4a-${bill.id}`
  insert('questions', {
    id: qid,
    slug: `medicare-for-all-${bill.id}`,
    body_id: US,
    parent_id: 'm4a',
    kind: 'formal_act',
    title: `Have they cosponsored ${bill.label}, the ${bill.title}?`,
    short_title: bill.label,
    description: `The ${bill.chamber} bill, introduced ${bill.introduced_on}.`,
    reference_url: bill.url,
    chamber: bill.chamber,
    is_hot: false,
    sort: i + 1,
  })
  const signers = [
    { bioguide: bill.sponsor, on: bill.introduced_on, act: `Introduced ${bill.label}, the ${bill.title}, as its sponsor.`, summary: `Sponsor of ${bill.label}.` },
    ...bill.cosponsors.map((c: any) => ({
      bioguide: c.bioguide,
      on: c.on,
      act: `Cosponsored ${bill.label}, the ${bill.title}${c.original ? ', as an original cosponsor' : ''}.`,
      summary: `Cosponsor of ${bill.label}.`,
    })),
  ]
  for (const s of signers) {
    if (!members.has(s.bioguide)) {
      skipped++ // signed on, then left Congress
      continue
    }
    const stamp = `${s.on}T00:00:00.000Z`
    insert('evidence', {
      id: `${qid}:${s.bioguide}`,
      question_id: qid,
      decider_id: s.bioguide,
      kind: 'formal_act',
      signals: 'support',
      quote: s.act,
      source_url: `${bill.url}/cosponsors`,
      source_title: `Congress.gov: ${bill.label} cosponsors`,
      occurred_on: s.on,
      submission_id: null,
      created_at: stamp,
    })
    for (const q of [qid, 'm4a']) {
      insert('stances', { id: `${q}:${s.bioguide}`, question_id: q, decider_id: s.bioguide, position: 'support', summary: s.summary, updated_at: stamp })
    }
  }
})

// ---- Demo body: fictional, exercises challengers and every footing ---------

const D = demo.body.id
insert('bodies', { ...demo.body, slug: D, is_demo: true, sort: 1 })
const demoIds = new Map<string, string>()
const person = (name: string) => {
  if (!demoIds.has(name)) {
    const slug = slugify(name)
    demoIds.set(name, `demo-${slug}`)
    const [first, ...rest] = name.split(' ')
    insert('deciders', { id: `demo-${slug}`, slug, name, sort_name: `${rest.join(' ')}, ${first}`, external_id: null, url: null })
  }
  return demoIds.get(name)!
}
for (const seat of demo.seats) {
  const seatId = `${D}:${slugify(`${D} ${seat.label}`).slice(D.length + 1)}`
  insert('seats', { id: seatId, body_id: D, chamber: null, region: null, label: seat.label, is_voting: true, next_election_on: demo.next_election_on })
  const [name, affiliation] = seat.incumbent
  insert('roles', { id: `${seatId}:${person(name)}`, seat_id: seatId, decider_id: person(name), kind: 'incumbent', contest: null, affiliation })
  for (const [cName, cAffiliation, contest] of seat.challengers) {
    insert('roles', { id: `${seatId}:${person(cName)}`, seat_id: seatId, decider_id: person(cName), kind: 'challenger', contest, affiliation: cAffiliation })
  }
}
demo.questions.forEach((q: any, i: number) => {
  insert('questions', {
    id: q.id,
    slug: q.id,
    body_id: D,
    parent_id: q.parent ?? null,
    kind: q.kind,
    title: q.title,
    short_title: q.short_title,
    description: q.description,
    reference_url: null,
    chamber: null,
    is_hot: q.is_hot ?? false,
    sort: i,
  })
})
for (const [q, name, position, summary] of demo.stances) {
  insert('stances', { id: `${q}:${person(name)}`, question_id: q, decider_id: person(name), position, summary, updated_at: '2026-11-01T00:00:00.000Z' })
}
demo.evidence.forEach(([q, name, kind, signals, on, quote, title]: string[], i: number) => {
  insert('evidence', {
    id: `demo-e${i + 1}`,
    question_id: q,
    decider_id: person(name),
    kind,
    signals,
    quote,
    source_url: `https://example.com/harbor-city/${i + 1}`,
    source_title: title,
    occurred_on: on,
    submission_id: null,
    created_at: `${on}T00:00:00.000Z`,
  })
})

mkdirSync(new URL('../seed/out/', import.meta.url), { recursive: true })
writeFileSync(new URL('../seed/out/seed.sql', import.meta.url), lines.join('\n') + '\n')
console.log(`${lines.length} rows written to seed/out/seed.sql${skipped ? ` (${skipped} signers no longer in the roster were skipped)` : ''}`)
