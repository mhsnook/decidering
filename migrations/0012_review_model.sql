-- Where someone stands on a position question is now worked out from their
-- record, and a reading says how much its act counts there. What editors used
-- to store per person and question (stances) becomes the rare position they
-- set by hand, shown instead of the calculated one.

-- How much an act counts on the question it is read on:
--   passing   a remark in passing, or about something next to the question
--   clear     says where they stand on this question in plain terms
--   concrete  a vote, a signature, a pledge or another use of office
-- It takes over from bearing: an indirect reading is a passing one.
ALTER TABLE readings ADD COLUMN weight TEXT NOT NULL DEFAULT 'clear' CHECK (weight IN ('passing', 'clear', 'concrete'));
UPDATE readings SET weight = CASE
  WHEN bearing = 'indirect' THEN 'passing'
  WHEN (SELECT a.kind FROM acts a WHERE a.id = readings.act_id) IN ('commits', 'does') THEN 'concrete'
  ELSE 'clear'
END;
-- A reading no longer leans against: that was a weak reading against.
UPDATE readings SET weight = 'passing' WHERE position = 'lean_oppose' AND weight = 'clear';
UPDATE readings SET position = 'oppose' WHERE position = 'lean_oppose';
ALTER TABLE readings DROP COLUMN bearing;
-- What a sub-question implies on its parent is a reading, so it cannot lean against either.
UPDATE questions SET implies_on_parent = 'oppose' WHERE implies_on_parent = 'lean_oppose';

-- NULL on a lead nobody has read: it claims no reading and no weight.
ALTER TABLE proposal_items ADD COLUMN weight TEXT CHECK (weight IN ('passing', 'clear', 'concrete'));
UPDATE proposal_items SET weight = CASE
  WHEN reading IS NULL THEN NULL
  WHEN bearing = 'indirect' THEN 'passing'
  WHEN kind IN ('commits', 'does') THEN 'concrete'
  ELSE 'clear'
END;
UPDATE proposal_items SET weight = 'passing' WHERE reading = 'lean_oppose' AND weight = 'clear';
UPDATE proposal_items SET reading = 'oppose' WHERE reading = 'lean_oppose';
ALTER TABLE proposal_items DROP COLUMN bearing;
ALTER TABLE proposal_items DROP COLUMN position;
ALTER TABLE proposal_items DROP COLUMN summary;

-- The passage of the source the quote sits in. It is published with the quote.
ALTER TABLE proposal_items ADD COLUMN passage TEXT;
ALTER TABLE reports ADD COLUMN passage TEXT;

-- Why a lead's article was not read, as a code a page can turn into a sentence.
ALTER TABLE proposals ADD COLUMN unread TEXT;

-- A position editors set by hand, with the reason shown beside it. While a row
-- is here the person is listed as this, not as their record works out.
CREATE TABLE set_positions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  position TEXT NOT NULL CHECK (position IN ('support', 'lean_support', 'mixed', 'lean_oppose', 'oppose')),
  reason TEXT NOT NULL,
  set_at TEXT NOT NULL,
  UNIQUE (question_id, decider_id)
);
DROP TABLE stances;

-- Links a question to a narrower version of it (a smaller step, such as an
-- amendment that limits it) or to a neighbouring one. `question_id` is the
-- fuller proposal of a smaller step.
CREATE TABLE question_relations (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  related_id TEXT NOT NULL REFERENCES questions(id),
  kind TEXT NOT NULL CHECK (kind IN ('smaller_step', 'related')),
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (question_id, related_id)
);
CREATE INDEX question_relations_related ON question_relations(related_id);

-- The day a decision on the question is expected. closed_on is the day it closed.
ALTER TABLE questions ADD COLUMN decides_on TEXT;

-- The text either side of an item's passage, for the editor to read the quote
-- in context. Fetched article text is not ours to republish, so this is only
-- sent to editors.
CREATE TABLE proposal_contexts (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  proposal_item_id TEXT NOT NULL REFERENCES proposal_items(id),
  before TEXT NOT NULL,
  after TEXT NOT NULL
);
CREATE INDEX proposal_contexts_proposal ON proposal_contexts(proposal_id);

-- People an article was read for and named, with nothing to record. Only sent
-- to editors.
CREATE TABLE proposal_mentions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  decider_id TEXT NOT NULL REFERENCES deciders(id),
  words TEXT NOT NULL
);
CREATE INDEX proposal_mentions_proposal ON proposal_mentions(proposal_id);
