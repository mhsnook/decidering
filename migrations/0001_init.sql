CREATE TABLE bodies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  jurisdiction TEXT,
  description TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE deciders (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_name TEXT NOT NULL,
  external_id TEXT,
  url TEXT
);

CREATE TABLE seats (
  id TEXT PRIMARY KEY,
  body_id TEXT NOT NULL REFERENCES bodies(id),
  chamber TEXT,
  region TEXT,
  label TEXT NOT NULL,
  is_voting INTEGER NOT NULL DEFAULT 1,
  next_election_on TEXT
);
CREATE INDEX seats_body ON seats(body_id);

-- A decider's relationship to a seat: holding it, or running for it.
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  seat_id TEXT NOT NULL REFERENCES seats(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  kind TEXT NOT NULL CHECK (kind IN ('incumbent', 'challenger')),
  contest TEXT CHECK (contest IN ('primary', 'general')),
  affiliation TEXT
);
CREATE INDEX roles_seat ON roles(seat_id);
CREATE INDEX roles_decider ON roles(decider_id);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  body_id TEXT NOT NULL REFERENCES bodies(id),
  parent_id TEXT REFERENCES questions(id),
  kind TEXT NOT NULL CHECK (kind IN ('position', 'formal_act')),
  title TEXT NOT NULL,
  short_title TEXT NOT NULL,
  description TEXT,
  reference_url TEXT,
  chamber TEXT,
  is_hot INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stances (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  position TEXT NOT NULL CHECK (position IN ('support', 'lean_support', 'mixed', 'lean_oppose', 'oppose')),
  summary TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (question_id, decider_id)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  kind TEXT NOT NULL CHECK (kind IN ('statement', 'formal_act', 'vote', 'platform', 'interview', 'social')),
  signals TEXT NOT NULL CHECK (signals IN ('support', 'lean_support', 'mixed', 'lean_oppose', 'oppose')),
  quote TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT,
  occurred_on TEXT NOT NULL,
  submission_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX evidence_pair ON evidence(question_id, decider_id);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  origin TEXT NOT NULL CHECK (origin IN ('public', 'news_search')),
  kind TEXT NOT NULL,
  signals TEXT,
  quote TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT,
  occurred_on TEXT,
  submitter_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX submissions_status ON submissions(status, created_at);
CREATE UNIQUE INDEX submissions_dedupe ON submissions(question_id, decider_id, source_url);
