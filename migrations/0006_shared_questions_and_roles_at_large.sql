-- A question can be put to more than one body, and a role can belong to a
-- person in their own right instead of to a body.

-- questions.body_id stays as the body a question is listed under first. Rows
-- here put it to further bodies. Positions and records are kept per person, so
-- someone who sits in two of them has one answer.
CREATE TABLE question_bodies (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  body_id TEXT NOT NULL REFERENCES bodies(id),
  UNIQUE (question_id, body_id)
);
CREATE INDEX question_bodies_body ON question_bodies(body_id);

-- The claim that someone holds a role should be checkable.
ALTER TABLE office_holders ADD COLUMN source_id TEXT REFERENCES sources(id);

-- offices.body_id becomes nullable: NULL is a role held at large, which shows
-- with its holder in every body they sit in. SQLite cannot relax NOT NULL in
-- place, so the table is rebuilt. Dropping it while office_holders and
-- question_offices still hold rows that point at it fails their foreign keys,
-- and deferring the check does not help: the new table taking the old name
-- does not clear a violation already counted. So their rows step aside first
-- and come back once the new table is in place.
CREATE TABLE office_holders_aside AS SELECT * FROM office_holders;
CREATE TABLE question_offices_aside AS SELECT * FROM question_offices;
DELETE FROM office_holders;
DELETE FROM question_offices;

CREATE TABLE offices_new (
  id TEXT PRIMARY KEY,
  body_id TEXT REFERENCES bodies(id),
  chamber TEXT,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT INTO offices_new (id, body_id, chamber, label, sort) SELECT id, body_id, chamber, label, sort FROM offices;
DROP TABLE offices;
ALTER TABLE offices_new RENAME TO offices;
CREATE INDEX offices_body ON offices(body_id);

INSERT INTO office_holders (id, office_id, decider_id, starts_on, ends_on, source_id) SELECT id, office_id, decider_id, starts_on, ends_on, source_id FROM office_holders_aside;
INSERT INTO question_offices (id, question_id, office_id) SELECT id, question_id, office_id FROM question_offices_aside;
DROP TABLE office_holders_aside;
DROP TABLE question_offices_aside;
