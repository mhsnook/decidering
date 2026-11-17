-- Splits `evidence` into the article (sources), the thing the decider did or
-- said (acts), the mention of one in the other (reports) and what the act
-- signals on one question (readings). `submissions` becomes proposals with
-- items. Existing rows are converted below, then the old tables are dropped.

ALTER TABLE questions ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'lapsed'));
ALTER TABLE questions ADD COLUMN closed_on TEXT;
ALTER TABLE questions ADD COLUMN closed_note TEXT;
-- A supporting reading here also writes a supporting reading on the parent.
ALTER TABLE questions ADD COLUMN implies_parent_support INTEGER NOT NULL DEFAULT 0;

-- Until now every measure's evidence counted toward its parent.
UPDATE questions SET implies_parent_support = 1 WHERE parent_id IS NOT NULL AND kind = 'formal_act';

-- A question with rows here is an ask of those people only. One without
-- applies to every seat in its body or chamber.
CREATE TABLE question_deciders (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  role_label TEXT,
  UNIQUE (question_id, decider_id)
);
CREATE INDEX question_deciders_decider ON question_deciders(decider_id);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  -- NULL for a document that reached us without a public address.
  url TEXT UNIQUE,
  title TEXT,
  publisher TEXT,
  published_on TEXT,
  kind TEXT CHECK (kind IN ('article', 'press_release', 'official_record', 'transcript', 'social_post')),
  archive_url TEXT,
  -- Where our own copy is kept, for a source with no URL to archive.
  stored_copy TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE acts (
  id TEXT PRIMARY KEY,
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  kind TEXT NOT NULL CHECK (kind IN ('statement', 'formal_act', 'vote', 'platform', 'interview', 'social')),
  occurred_on TEXT NOT NULL,
  body TEXT NOT NULL,
  -- The record of the act itself (the press release, the roll-call page), as
  -- opposed to a source that reports it.
  primary_source_id TEXT REFERENCES sources(id),
  created_at TEXT NOT NULL
);
CREATE INDEX acts_decider ON acts(decider_id);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  act_id TEXT NOT NULL REFERENCES acts(id),
  excerpt TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, act_id)
);
CREATE INDEX reports_act ON reports(act_id);

CREATE TABLE readings (
  id TEXT PRIMARY KEY,
  act_id TEXT NOT NULL REFERENCES acts(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  position TEXT NOT NULL CHECK (position IN ('support', 'lean_support', 'mixed', 'lean_oppose', 'oppose')),
  -- Set on a reading written because a sub-question implies support on this one.
  via_question_id TEXT REFERENCES questions(id),
  created_at TEXT NOT NULL,
  UNIQUE (act_id, question_id)
);
CREATE INDEX readings_question ON readings(question_id);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  origin TEXT NOT NULL CHECK (origin IN ('reader', 'news_search', 'partner', 'model')),
  submitted_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX proposals_status ON proposals(status, created_at);
CREATE INDEX proposals_source ON proposals(source_id);

CREATE TABLE proposal_items (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  sort INTEGER NOT NULL DEFAULT 0,
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  -- Not a foreign key: it names an act already on file, or the id a new act
  -- will take if the item is accepted. Items that share it describe one act.
  act_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('statement', 'formal_act', 'vote', 'platform', 'interview', 'social')),
  occurred_on TEXT,
  quote TEXT NOT NULL,
  reading TEXT CHECK (reading IN ('support', 'lean_support', 'mixed', 'lean_oppose', 'oppose')),
  position TEXT CHECK (position IN ('support', 'lean_support', 'mixed', 'lean_oppose', 'oppose')),
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected'))
);
CREATE INDEX proposal_items_proposal ON proposal_items(proposal_id);
CREATE INDEX proposal_items_act ON proposal_items(act_id);

-- Proposals and their items are readable by everyone. Whatever a submitter or
-- a reviewer wrote for editors only lives here instead.
CREATE TABLE proposal_notes (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  proposal_item_id TEXT REFERENCES proposal_items(id),
  kind TEXT NOT NULL CHECK (kind IN ('submitter', 'review')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX proposal_notes_proposal ON proposal_notes(proposal_id);

-- ---- Conversion -------------------------------------------------------------

-- One source per distinct URL. The title an editor published wins over one a
-- submitter typed. A URL cited only by seeded formal acts and votes is the
-- official record of them; the kind of any other source is left unset.
INSERT INTO sources (id, url, title, kind, created_at)
SELECT
  lower(hex(randomblob(16))),
  u.url,
  COALESCE(
    (SELECT e.source_title FROM evidence e WHERE e.source_url = u.url AND e.source_title IS NOT NULL ORDER BY e.created_at DESC LIMIT 1),
    (SELECT s.source_title FROM submissions s WHERE s.source_url = u.url AND s.source_title IS NOT NULL ORDER BY s.created_at DESC LIMIT 1)
  ),
  CASE
    WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.source_url = u.url)
      AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.source_url = u.url AND (e.kind NOT IN ('formal_act', 'vote') OR e.submission_id IS NOT NULL))
    THEN 'official_record'
  END,
  u.created_at
FROM (
  SELECT url, MIN(created_at) AS created_at
  FROM (SELECT source_url AS url, created_at FROM evidence UNION ALL SELECT source_url, created_at FROM submissions)
  GROUP BY url
) u;

-- Each evidence row becomes an act, a report and a reading that share its id.
INSERT INTO acts (id, decider_id, kind, occurred_on, body, primary_source_id, created_at)
SELECT
  e.id, e.decider_id, e.kind, e.occurred_on, e.quote,
  CASE WHEN e.kind IN ('formal_act', 'vote') AND e.submission_id IS NULL THEN s.id END,
  e.created_at
FROM evidence e JOIN sources s ON s.url = e.source_url;

INSERT INTO reports (id, source_id, act_id, excerpt, created_at)
SELECT e.id, s.id, e.id, NULL, e.created_at
FROM evidence e JOIN sources s ON s.url = e.source_url;

INSERT INTO readings (id, act_id, question_id, position, via_question_id, created_at)
SELECT e.id, e.id, e.question_id, e.signals, NULL, e.created_at FROM evidence e;

INSERT INTO readings (id, act_id, question_id, position, via_question_id, created_at)
SELECT e.id || ':parent', e.id, q.parent_id, 'support', q.id, e.created_at
FROM evidence e JOIN questions q ON q.id = e.question_id
WHERE q.implies_parent_support = 1 AND q.parent_id IS NOT NULL AND e.signals = 'support';

-- Each submission becomes a proposal with one item that shares its id.
INSERT INTO proposals (id, source_id, origin, submitted_by, status, created_at, reviewed_at)
SELECT
  sub.id, s.id,
  CASE sub.origin WHEN 'public' THEN 'reader' ELSE sub.origin END,
  NULL,
  CASE sub.status WHEN 'pending' THEN 'pending' ELSE 'reviewed' END,
  sub.created_at, sub.reviewed_at
FROM submissions sub JOIN sources s ON s.url = sub.source_url;

-- An approved submission's item points at the act made from its evidence row.
INSERT INTO proposal_items (id, proposal_id, sort, decider_id, question_id, act_id, kind, occurred_on, quote, reading, position, summary, status)
SELECT
  sub.id, sub.id, 0, sub.decider_id, sub.question_id,
  COALESCE((SELECT e.id FROM evidence e WHERE e.submission_id = sub.id LIMIT 1), lower(hex(randomblob(16)))),
  sub.kind, sub.occurred_on, sub.quote, sub.signals, NULL, NULL,
  CASE sub.status WHEN 'approved' THEN 'accepted' ELSE sub.status END
FROM submissions sub;

INSERT INTO proposal_notes (id, proposal_id, proposal_item_id, kind, body, created_at)
SELECT lower(hex(randomblob(16))), sub.id, NULL, 'submitter', sub.submitter_note, sub.created_at
FROM submissions sub WHERE sub.submitter_note IS NOT NULL;

INSERT INTO proposal_notes (id, proposal_id, proposal_item_id, kind, body, created_at)
SELECT lower(hex(randomblob(16))), sub.id, NULL, 'review', sub.review_note, COALESCE(sub.reviewed_at, sub.created_at)
FROM submissions sub WHERE sub.review_note IS NOT NULL;

DROP TABLE evidence;
DROP TABLE submissions;
