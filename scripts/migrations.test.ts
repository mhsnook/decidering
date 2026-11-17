import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeAll, describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const migrations = readdirSync(new URL('migrations/', root)).sort()
const migration = (name: string) => readFileSync(new URL(`migrations/${name}`, root), 'utf8')

// D1 enforces foreign keys, so the stand-in does too.
function database(upTo?: string) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of migrations) {
    if (upTo && name >= upTo) break
    db.exec(migration(name))
  }
  return db
}
const all = (db: DatabaseSync, query: string) => db.prepare(query).all() as Record<string, any>[]
const count = (db: DatabaseSync, table: string) => all(db, `SELECT COUNT(*) AS n FROM ${table}`)[0].n as number

describe('0004_evidence_model', () => {
  const db = database('0004')
  db.exec(`
    INSERT INTO bodies (id, slug, name) VALUES ('b', 'b', 'Body');
    INSERT INTO deciders (id, slug, name, sort_name) VALUES ('ann', 'ann', 'Ann', 'Ann'), ('bob', 'bob', 'Bob', 'Bob');
    INSERT INTO questions (id, slug, body_id, parent_id, kind, title, short_title) VALUES
      ('policy', 'policy', 'b', NULL, 'position', 'Policy?', 'Policy'),
      ('bill', 'bill', 'b', 'policy', 'formal_act', 'Signed the bill?', 'Bill');
    INSERT INTO stances (id, question_id, decider_id, position, summary, updated_at) VALUES
      ('bill:ann', 'bill', 'ann', 'support', 'Cosponsor.', '2026-01-01'),
      ('policy:ann', 'policy', 'ann', 'support', 'Cosponsor.', '2026-01-01');
    INSERT INTO evidence (id, question_id, decider_id, kind, signals, quote, source_url, source_title, occurred_on, submission_id, created_at) VALUES
      ('e-ann-signed', 'bill', 'ann', 'formal_act', 'support', 'Cosponsored the bill.', 'https://record.example/bill', 'Official record', '2026-01-01', NULL, '2026-01-01T00:00:00Z'),
      ('e-bob-signed', 'bill', 'bob', 'formal_act', 'support', 'Cosponsored the bill.', 'https://record.example/bill', 'Official record', '2026-01-02', NULL, '2026-01-02T00:00:00Z'),
      ('e-bob-wavers', 'bill', 'bob', 'interview', 'mixed', 'I may take my name off it.', 'https://news.example/roundup', 'Roundup, as published', '2026-02-01', 's-approved', '2026-02-02T00:00:00Z'),
      ('e-ann-said', 'policy', 'ann', 'statement', 'support', 'I am for it.', 'https://news.example/roundup', 'Roundup, as published', '2026-02-01', NULL, '2026-02-03T00:00:00Z');
    INSERT INTO submissions (id, question_id, decider_id, origin, kind, signals, quote, source_url, source_title, occurred_on, submitter_note, status, review_note, created_at, reviewed_at) VALUES
      ('s-approved', 'bill', 'bob', 'public', 'interview', 'mixed', 'I might take my name off.', 'https://news.example/roundup', 'roundup, as typed', '2026-02-01', 'Minute 12.', 'approved', 'Checked.', '2026-02-01T10:00:00Z', '2026-02-02T00:00:00Z'),
      ('s-rejected', 'policy', 'bob', 'public', 'statement', 'oppose', 'Made up words.', 'https://blog.example/rumour', NULL, NULL, NULL, 'rejected', 'Unsourced.', '2026-02-04T00:00:00Z', '2026-02-05T00:00:00Z'),
      ('s-pending', 'policy', 'ann', 'public', 'statement', 'support', 'Pending words.', 'https://blog.example/rumour', 'Rumour blog', NULL, NULL, 'pending', NULL, '2026-02-06T00:00:00Z', NULL),
      ('s-lead', 'policy', 'bob', 'news_search', 'statement', NULL, 'A search excerpt.', 'https://wire.example/story', 'Wire story', NULL, 'Search excerpt, not a verified quote.', 'pending', NULL, '2026-02-07T00:00:00Z', NULL);
  `)
  db.exec(migration('0004_evidence_model.sql'))

  it('makes one source per distinct URL', () => {
    expect(all(db, `SELECT url, title, kind FROM sources ORDER BY url`)).toEqual([
      { url: 'https://blog.example/rumour', title: 'Rumour blog', kind: null },
      // An editor's published title wins over the one the submitter typed.
      { url: 'https://news.example/roundup', title: 'Roundup, as published', kind: null },
      { url: 'https://record.example/bill', title: 'Official record', kind: 'official_record' },
      { url: 'https://wire.example/story', title: 'Wire story', kind: null },
    ])
  })

  it('turns each evidence row into an act, a report and a reading with the same id', () => {
    expect(all(db, `SELECT a.id, a.decider_id, a.kind, a.occurred_on, a.body, s.url, p.url AS primary_url, r.question_id, r.position
      FROM acts a JOIN reports rep ON rep.id = a.id AND rep.act_id = a.id JOIN sources s ON s.id = rep.source_id
      JOIN readings r ON r.id = a.id AND r.act_id = a.id LEFT JOIN sources p ON p.id = a.primary_source_id ORDER BY a.id`)).toEqual([
      { id: 'e-ann-said', decider_id: 'ann', kind: 'statement', occurred_on: '2026-02-01', body: 'I am for it.', url: 'https://news.example/roundup', primary_url: null, question_id: 'policy', position: 'support' },
      { id: 'e-ann-signed', decider_id: 'ann', kind: 'formal_act', occurred_on: '2026-01-01', body: 'Cosponsored the bill.', url: 'https://record.example/bill', primary_url: 'https://record.example/bill', question_id: 'bill', position: 'support' },
      { id: 'e-bob-signed', decider_id: 'bob', kind: 'formal_act', occurred_on: '2026-01-02', body: 'Cosponsored the bill.', url: 'https://record.example/bill', primary_url: 'https://record.example/bill', question_id: 'bill', position: 'support' },
      { id: 'e-bob-wavers', decider_id: 'bob', kind: 'interview', occurred_on: '2026-02-01', body: 'I may take my name off it.', url: 'https://news.example/roundup', primary_url: null, question_id: 'bill', position: 'mixed' },
    ])
    expect(count(db, 'acts')).toBe(4)
    expect(count(db, 'reports')).toBe(4)
  })

  it('marks measures and copies only their supporting readings to the parent', () => {
    expect(all(db, `SELECT id, implies_parent_support, status FROM questions ORDER BY id`)).toEqual([
      { id: 'bill', implies_parent_support: 1, status: 'open' },
      { id: 'policy', implies_parent_support: 0, status: 'open' },
    ])
    expect(all(db, `SELECT act_id, question_id, position, via_question_id FROM readings WHERE via_question_id IS NOT NULL ORDER BY act_id`)).toEqual([
      { act_id: 'e-ann-signed', question_id: 'policy', position: 'support', via_question_id: 'bill' },
      { act_id: 'e-bob-signed', question_id: 'policy', position: 'support', via_question_id: 'bill' },
    ])
  })

  it('turns each submission into a proposal with one item', () => {
    expect(all(db, `SELECT p.id, p.origin, p.status, p.reviewed_at, s.url, i.id AS item_id, i.decider_id, i.question_id, i.kind, i.quote, i.reading, i.status AS item_status
      FROM proposals p JOIN sources s ON s.id = p.source_id JOIN proposal_items i ON i.proposal_id = p.id ORDER BY p.id`)).toEqual([
      { id: 's-approved', origin: 'reader', status: 'reviewed', reviewed_at: '2026-02-02T00:00:00Z', url: 'https://news.example/roundup', item_id: 's-approved', decider_id: 'bob', question_id: 'bill', kind: 'interview', quote: 'I might take my name off.', reading: 'mixed', item_status: 'accepted' },
      { id: 's-lead', origin: 'news_search', status: 'pending', reviewed_at: null, url: 'https://wire.example/story', item_id: 's-lead', decider_id: 'bob', question_id: 'policy', kind: 'statement', quote: 'A search excerpt.', reading: null, item_status: 'pending' },
      { id: 's-pending', origin: 'reader', status: 'pending', reviewed_at: null, url: 'https://blog.example/rumour', item_id: 's-pending', decider_id: 'ann', question_id: 'policy', kind: 'statement', quote: 'Pending words.', reading: 'support', item_status: 'pending' },
      { id: 's-rejected', origin: 'reader', status: 'reviewed', reviewed_at: '2026-02-05T00:00:00Z', url: 'https://blog.example/rumour', item_id: 's-rejected', decider_id: 'bob', question_id: 'policy', kind: 'statement', quote: 'Made up words.', reading: 'oppose', item_status: 'rejected' },
    ])
  })

  it('points an approved item at the act made from its evidence, and gives the others an id no act has', () => {
    const items = all(db, `SELECT i.id, i.act_id, (SELECT 1 FROM acts a WHERE a.id = i.act_id) AS on_file FROM proposal_items i ORDER BY i.id`)
    expect(items[0]).toEqual({ id: 's-approved', act_id: 'e-bob-wavers', on_file: 1 })
    expect(items.slice(1).map((i) => i.on_file)).toEqual([null, null, null])
    expect(new Set(items.map((i) => i.act_id)).size).toBe(4)
  })

  it('moves what was written for editors into notes', () => {
    expect(all(db, `SELECT proposal_id, kind, body FROM proposal_notes ORDER BY proposal_id, kind`)).toEqual([
      { proposal_id: 's-approved', kind: 'review', body: 'Checked.' },
      { proposal_id: 's-approved', kind: 'submitter', body: 'Minute 12.' },
      { proposal_id: 's-lead', kind: 'submitter', body: 'Search excerpt, not a verified quote.' },
      { proposal_id: 's-rejected', kind: 'review', body: 'Unsourced.' },
    ])
  })

  it('leaves stances alone, drops the old tables and breaks no reference', () => {
    expect(all(db, `SELECT id, position, summary FROM stances ORDER BY id`)).toEqual([
      { id: 'bill:ann', position: 'support', summary: 'Cosponsor.' },
      { id: 'policy:ann', position: 'support', summary: 'Cosponsor.' },
    ])
    expect(all(db, `SELECT name FROM sqlite_master WHERE name IN ('evidence', 'submissions')`)).toEqual([])
    expect(all(db, `PRAGMA foreign_key_check`)).toEqual([])
  })
})

describe('the seed', () => {
  let seed = ''
  beforeAll(() => {
    execFileSync(process.execPath, [new URL('scripts/build-seed.ts', root).pathname], { stdio: 'ignore' })
    seed = readFileSync(new URL('seed/out/seed.sql', root), 'utf8')
  })

  it('loads into the migrated schema, and loads again without duplicating anything', () => {
    const db = database()
    db.exec(seed)
    const tables = ['sources', 'acts', 'reports', 'readings', 'stances', 'questions', 'question_deciders', 'offices', 'office_holders', 'question_offices', 'roles']
    const first = tables.map((t) => count(db, t))
    expect(count(db, 'acts')).toBeGreaterThan(0)
    expect(count(db, 'reports')).toBe(count(db, 'acts'))
    db.exec(seed)
    expect(tables.map((t) => count(db, t))).toEqual(first)
    expect(all(db, `PRAGMA foreign_key_check`)).toEqual([])
  })

  it('finds the source a database already holds for a URL instead of adding another', () => {
    const db = database()
    const url = /INSERT INTO sources \(id, url, title, kind, created_at\) VALUES \('[^']+', '([^']+)'/.exec(seed)![1]
    db.prepare(`INSERT INTO sources (id, url, created_at) VALUES ('held', ?, '2026-01-01')`).run(url)
    db.exec(seed)
    expect(all(db, `SELECT id FROM sources WHERE url = '${url}'`)).toEqual([{ id: 'held' }])
    expect(all(db, `SELECT COUNT(*) AS n FROM reports WHERE source_id = 'held'`)[0].n).toBeGreaterThan(0)
  })

  it('writes a parent reading for every supporting reading on a question that implies it', () => {
    const db = database()
    db.exec(seed)
    expect(all(db, `SELECT COUNT(*) AS n FROM readings r JOIN questions q ON q.id = r.question_id
      WHERE q.implies_parent_support = 1 AND r.position = 'support'
        AND NOT EXISTS (SELECT 1 FROM readings p WHERE p.act_id = r.act_id AND p.question_id = q.parent_id AND p.via_question_id = q.id)`)[0].n).toBe(0)
  })

  it('seeds an open ask of an office in Congress, with a holder now and one from the next term', () => {
    const db = database()
    db.exec(seed)
    expect(all(db, `SELECT q.parent_id, q.status, q.implies_parent_support, o.label, b.next_term_on FROM questions q
      JOIN question_offices l ON l.question_id = q.id JOIN offices o ON o.id = l.office_id JOIN bodies b ON b.id = o.body_id WHERE q.id = 'm4a-s1506-markup'`)).toEqual([
      { parent_id: 'm4a', status: 'open', implies_parent_support: 0, label: 'Chair, Senate Finance Committee', next_term_on: '2027-01-03' },
    ])
    expect(all(db, `SELECT d.name, h.starts_on, h.ends_on FROM office_holders h JOIN deciders d ON d.id = h.decider_id
      WHERE h.office_id = 'us-senate-finance-chair' ORDER BY h.starts_on IS NOT NULL`)).toEqual([
      { name: 'Mike Crapo', starts_on: null, ends_on: '2027-01-03' },
      { name: 'Ron Wyden', starts_on: '2027-01-03', ends_on: null },
    ])
    expect(all(db, `SELECT COUNT(*) AS n FROM readings WHERE question_id = 'm4a-s1506-markup'`)[0].n).toBe(0)
  })

  it('moves an ask that named a person onto its office when the asks file is replayed alone', () => {
    const db = database()
    db.exec(seed)
    db.exec(`INSERT INTO question_deciders (id, question_id, decider_id, role_label) VALUES ('old', 'm4a-s1506-markup', 'W000779', 'Ranking Member, Senate Finance Committee')`)
    db.exec(readFileSync(new URL('seed/out/us-congress-asks.sql', root), 'utf8'))
    expect(all(db, `SELECT COUNT(*) AS n FROM question_deciders WHERE question_id = 'm4a-s1506-markup'`)[0].n).toBe(0)
    expect(all(db, `PRAGMA foreign_key_check`)).toEqual([])
  })
})
