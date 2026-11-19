-- A body's membership and its key roles change on known dates. Rows carry the
-- dates they hold between, so a page can show the body as it stands on any day,
-- including one that has not come yet.

-- NULL starts_on means "since before we kept track"; NULL ends_on means "no end
-- known". A row is in effect on a day D when starts_on <= D < ends_on.
ALTER TABLE roles ADD COLUMN starts_on TEXT;
ALTER TABLE roles ADD COLUMN ends_on TEXT;

-- The day the body next changes over, and what to call it after that
-- ("120th Congress"). Pages offer that day as a second view.
ALTER TABLE bodies ADD COLUMN next_term_on TEXT;
ALTER TABLE bodies ADD COLUMN next_term_label TEXT;

-- A key role in a body, such as a committee chair. It outlives its holders.
CREATE TABLE offices (
  id TEXT PRIMARY KEY,
  body_id TEXT NOT NULL REFERENCES bodies(id),
  chamber TEXT,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX offices_body ON offices(body_id);

CREATE TABLE office_holders (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  starts_on TEXT,
  ends_on TEXT
);
CREATE INDEX office_holders_office ON office_holders(office_id);
CREATE INDEX office_holders_decider ON office_holders(decider_id);

-- An ask put to whoever holds an office, as opposed to question_deciders,
-- which puts it to a person by name.
CREATE TABLE question_offices (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  office_id TEXT NOT NULL REFERENCES offices(id),
  UNIQUE (question_id, office_id)
);
CREATE INDEX question_offices_office ON question_offices(office_id);
