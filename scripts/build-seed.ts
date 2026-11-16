// Turns seed/data/*.json into seed/out/seed.sql, plus one file per data set so a
// new one can be added to a live database without replaying the others over
// rows editors have since changed. Seeding writes rows directly, which skips the
// sync log: run it before anyone is connected (a page reload picks the rows up
// from the snapshot).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../seed/data/${name}`, import.meta.url), 'utf8'))
const congress = read('us-congress.json')
const era = read('us-states-era.json')
const demo = read('demo.json')

const dataSets = new Map<string, string[]>()
let lines: string[] = []
function dataSet(name: string) {
  lines = []
  dataSets.set(name, lines)
}
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

dataSet('us-congress')
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

// ---- The states and the Equal Rights Amendment: the National Archives' list --

dataSet('us-states')
const STATES = 'us-states'
insert('bodies', {
  id: STATES,
  slug: STATES,
  name: 'State legislatures',
  jurisdiction: 'United States',
  description: `The 50 state legislatures, which ratify amendments to the U.S. Constitution. Ratification records from the National Archives as of ${era.as_of}.`,
  is_demo: false,
  sort: 1,
})

const ratified = era.states.filter((s: any) => s.ratified_on)
const late = ratified.filter((s: any) => s.ratified_on > era.deadline)
const rescinded = ratified.filter((s: any) => s.rescinded_on)
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
insert('questions', {
  id: 'era',
  slug: 'equal-rights-amendment',
  body_id: STATES,
  parent_id: null,
  kind: 'formal_act',
  title: 'Has the state ratified the Equal Rights Amendment?',
  short_title: 'Equal Rights Amendment',
  description: `Congress sent the amendment to the states in 1972. It needs ${era.threshold} of the ${era.states.length} to ratify. By the deadline, which Congress extended to ${longDate(era.deadline)}, ${ratified.length - late.length} had. Another ${late.length} ratified after it, and ${rescinded.length} of the first ${ratified.length - late.length} have voted to rescind. Whether a late ratification counts, and whether a state can take one back, are unsettled.`,
  reference_url: null,
  chamber: null,
  is_hot: false,
  sort: 0,
  threshold: era.threshold,
  act_label: 'Ratified',
})

for (const state of era.states) {
  const id = `us-state-${state.code}`
  const seatId = `${STATES}:${state.code}`
  insert('deciders', { id, slug: slugify(state.name), name: state.name, sort_name: state.name, external_id: state.code, url: null })
  insert('seats', { id: seatId, body_id: STATES, chamber: null, region: state.code, label: state.code, is_voting: true, next_election_on: null })
  insert('roles', { id: `${seatId}:${id}`, seat_id: seatId, decider_id: id, kind: 'incumbent', contest: null, affiliation: null })
  if (!state.ratified_on) continue

  const isLate = state.ratified_on > era.deadline
  const year = (iso: string) => iso.slice(0, 4)
  const act = (suffix: string, on: string, signals: string, quote: string) =>
    insert('evidence', {
      id: `era:${state.code}:${suffix}`,
      question_id: 'era',
      decider_id: id,
      kind: 'formal_act',
      signals,
      quote,
      source_url: era.source.url,
      source_title: era.source.title,
      occurred_on: on,
      submission_id: null,
      created_at: `${on}T00:00:00.000Z`,
    })
  act('ratified', state.ratified_on, 'support', `Ratified the Equal Rights Amendment${isLate ? ', after the deadline set by Congress had passed' : ''}.`)
  if (state.rescinded_on) {
    act('rescinded', state.rescinded_on, 'oppose', 'Voted to rescind its ratification of the Equal Rights Amendment. The National Archives records this as a purported rescission.')
  }
  insert('stances', {
    id: `era:${id}`,
    question_id: 'era',
    decider_id: id,
    position: state.rescinded_on ? 'mixed' : 'support',
    summary: state.rescinded_on
      ? `Ratified in ${year(state.ratified_on)} and voted to rescind in ${year(state.rescinded_on)}. Whether a state can take back a ratification is unsettled.`
      : `Ratified in ${year(state.ratified_on)}${isLate ? `, after the ${year(era.deadline)} deadline` : ''}.`,
    updated_at: `${era.as_of}T00:00:00.000Z`,
  })
}

// ---- Demo body: fictional, exercises challengers and every footing ---------

dataSet('demo')
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
const write = (name: string, rows: string[]) => writeFileSync(new URL(`../seed/out/${name}.sql`, import.meta.url), rows.join('\n') + '\n')
for (const [name, rows] of dataSets) write(name, rows)
const all = [...dataSets.values()].flat()
write('seed', all)
console.log(`${all.length} rows written to seed/out/seed.sql${skipped ? ` (${skipped} signers no longer in the roster were skipped)` : ''}`)
for (const [name, rows] of dataSets) console.log(`  ${rows.length} of them also in seed/out/${name}.sql`)
