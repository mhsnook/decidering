// Turns seed/data/*.json into seed/out/seed.sql, plus one file per data set so a
// new one can be added to a live database without replaying the others over
// rows editors have since changed. Seeding writes rows directly, which skips the
// sync log: run it before anyone is connected (a page reload picks the rows up
// from the snapshot).
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../seed/data/${name}`, import.meta.url), 'utf8'))
const congress = read('us-congress.json')
const congressAsks = read('us-congress-asks.json')
const era = read('us-states-era.json')
const demo = read('demo.json')

const dataSets = new Map<string, string[]>()
let lines: string[] = []
let dataSetName = ''
function dataSet(name: string) {
  dataSetName = name
  lines = []
  dataSets.set(name, lines)
}
class Sql {
  readonly text: string
  constructor(text: string) {
    this.text = text
  }
}
const sql = (v: unknown) =>
  v instanceof Sql ? v.text : v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replaceAll("'", "''")}'`
function insert(table: string, row: Record<string, unknown>) {
  lines.push(`INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(sql).join(', ')});`)
}

type SourceRef = { url: string; title: string; kind: string }
// A database that was migrated or edited before this seed ran already has a row
// for the URL under another id, so rows that point at a source look it up.
const sourceId = (url: string) => new Sql(`(SELECT id FROM sources WHERE url = ${sql(url)})`)
function source(ref: SourceRef, created_at: string) {
  const id = `seed-${createHash('sha1').update(ref.url).digest('hex').slice(0, 12)}`
  lines.push(
    `INSERT INTO sources (id, url, title, kind, created_at) VALUES (${[id, ref.url, ref.title, ref.kind, created_at].map(sql).join(', ')}) ON CONFLICT (url) DO UPDATE SET title = excluded.title, kind = excluded.kind;`,
  )
}

const questions = new Map<string, { parent_id: string | null; implies_parent_support: boolean }>()
function question(row: { id: string; parent_id: string | null; implies_parent_support?: boolean } & Record<string, unknown>) {
  const full = { threshold: null, act_label: null, status: 'open', closed_on: null, closed_note: null, implies_parent_support: false, ...row }
  questions.set(full.id, full)
  insert('questions', full)
}

const RECORDED = new Set(['formal_act', 'vote'])
const sourcesWritten = new Set<string>()
// One act, the source that reports it and what it signals on one question.
function act(a: { id: string; question_id: string; decider_id: string; kind: string; position: string; occurred_on: string; body: string; source: SourceRef }) {
  const created_at = `${a.occurred_on}T00:00:00.000Z`
  const key = `${dataSetName} ${a.source.url}`
  if (!sourcesWritten.has(key)) {
    sourcesWritten.add(key)
    source(a.source, created_at)
  }
  insert('acts', {
    id: a.id,
    decider_id: a.decider_id,
    kind: a.kind,
    occurred_on: a.occurred_on,
    body: a.body,
    primary_source_id: RECORDED.has(a.kind) ? sourceId(a.source.url) : null,
    created_at,
  })
  insert('reports', { id: a.id, source_id: sourceId(a.source.url), act_id: a.id, excerpt: null, created_at })
  insert('readings', { id: a.id, act_id: a.id, question_id: a.question_id, position: a.position, via_question_id: null, created_at })
  const q = questions.get(a.question_id)!
  if (q.implies_parent_support && q.parent_id && a.position === 'support') {
    insert('readings', { id: `${a.id}:parent`, act_id: a.id, question_id: q.parent_id, position: 'support', via_question_id: a.question_id, created_at })
  }
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
  next_term_on: congressAsks.next_term.on,
  next_term_label: congressAsks.next_term.label,
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

question({
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
  question({
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
    implies_parent_support: true,
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
    act({
      id: `${qid}:${s.bioguide}`,
      question_id: qid,
      decider_id: s.bioguide,
      kind: 'formal_act',
      position: 'support',
      occurred_on: s.on,
      body: s.act,
      source: { url: `${bill.url}/cosponsors`, title: `Congress.gov: ${bill.label} cosponsors`, kind: 'official_record' },
    })
    for (const q of [qid, 'm4a']) {
      insert('stances', { id: `${q}:${s.bioguide}`, question_id: q, decider_id: s.bioguide, position: 'support', summary: s.summary, updated_at: stamp })
    }
  }
})

// ---- Asks of key people in Congress: its own file, so it can be added to a
// database without replaying the roster and stances over an editor's changes --

dataSet('us-congress-asks')
const member = (bioguide: string, where: string) => {
  if (!members.has(bioguide)) throw new Error(`${where} names ${bioguide}, who is not in the roster`)
  return bioguide
}
// Also set by the roster's own file. Repeated so this file works alone.
lines.push(`UPDATE bodies SET next_term_on = ${sql(congressAsks.next_term.on)}, next_term_label = ${sql(congressAsks.next_term.label)} WHERE id = ${sql(US)};`)
congressAsks.offices.forEach((o: any, i: number) => {
  insert('offices', { id: o.id, body_id: US, chamber: o.chamber, label: o.label, sort: i })
  for (const h of o.holders) {
    insert('office_holders', { id: `${o.id}:${member(h.bioguide, o.id)}`, office_id: o.id, decider_id: h.bioguide, starts_on: h.starts_on ?? null, ends_on: h.ends_on ?? null })
  }
})
congressAsks.asks.forEach((ask: any, i: number) => {
  question({
    id: ask.id,
    slug: ask.slug,
    body_id: US,
    parent_id: ask.parent,
    kind: 'position',
    title: ask.title,
    short_title: ask.short_title,
    description: ask.description,
    reference_url: null,
    chamber: ask.chamber,
    is_hot: false,
    sort: 100 + i,
  })
  // An ask that used to name people and now names offices must not keep both.
  lines.push(`DELETE FROM question_deciders WHERE question_id = ${sql(ask.id)};`)
  for (const d of ask.deciders ?? []) {
    insert('question_deciders', { id: `${ask.id}:${member(d.bioguide, ask.id)}`, question_id: ask.id, decider_id: d.bioguide, role_label: d.role_label })
  }
  for (const officeId of ask.offices ?? []) insert('question_offices', { id: `${ask.id}:${officeId}`, question_id: ask.id, office_id: officeId })
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
question({
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
  const record = (suffix: string, on: string, position: string, body: string) =>
    act({
      id: `era:${state.code}:${suffix}`,
      question_id: 'era',
      decider_id: id,
      kind: 'formal_act',
      position,
      occurred_on: on,
      body,
      source: { ...era.source, kind: 'official_record' },
    })
  record('ratified', state.ratified_on, 'support', `Ratified the Equal Rights Amendment${isLate ? ', after the deadline set by Congress had passed' : ''}.`)
  if (state.rescinded_on) {
    record('rescinded', state.rescinded_on, 'oppose', 'Voted to rescind its ratification of the Equal Rights Amendment. The National Archives records this as a purported rescission.')
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
  question({
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
    implies_parent_support: q.kind === 'formal_act' && !!q.parent,
    status: q.status ?? 'open',
    closed_on: q.closed_on ?? null,
    closed_note: q.closed_note ?? null,
  })
  for (const [name, role_label] of q.deciders ?? []) {
    insert('question_deciders', { id: `${q.id}:${person(name)}`, question_id: q.id, decider_id: person(name), role_label })
  }
})
for (const [q, name, position, summary] of demo.stances) {
  insert('stances', { id: `${q}:${person(name)}`, question_id: q, decider_id: person(name), position, summary, updated_at: '2026-11-01T00:00:00.000Z' })
}
const DEMO_SOURCE_KIND: Record<string, string> = { formal_act: 'official_record', vote: 'official_record', social: 'social_post' }
demo.acts.forEach(([q, name, kind, position, on, body, title]: string[], i: number) => {
  act({
    id: `demo-e${i + 1}`,
    question_id: q,
    decider_id: person(name),
    kind,
    position,
    occurred_on: on,
    body,
    source: { url: `https://example.com/harbor-city/${i + 1}`, title, kind: DEMO_SOURCE_KIND[kind] ?? 'article' },
  })
})

mkdirSync(new URL('../seed/out/', import.meta.url), { recursive: true })
const write = (name: string, rows: string[]) => writeFileSync(new URL(`../seed/out/${name}.sql`, import.meta.url), rows.join('\n') + '\n')
for (const [name, rows] of dataSets) write(name, rows)
const all = [...dataSets.values()].flat()
write('seed', all)
console.log(`${all.length} rows written to seed/out/seed.sql${skipped ? ` (${skipped} signers no longer in the roster were skipped)` : ''}`)
for (const [name, rows] of dataSets) console.log(`  ${rows.length} of them also in seed/out/${name}.sql`)
