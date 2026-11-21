-- A fourth weight, below passing: someone else's account of where a person
-- stands, with no words or act of their own. It lists them as presumed until
-- there is something of theirs to go on.
--
-- The weight columns carry a CHECK listing three weights, which SQLite cannot
-- alter, so the values go in a new column that then takes the name.
ALTER TABLE readings ADD COLUMN counts TEXT NOT NULL DEFAULT 'clear' CHECK (counts IN ('presumed', 'passing', 'clear', 'concrete'));
UPDATE readings SET counts = weight;
ALTER TABLE readings DROP COLUMN weight;
ALTER TABLE readings RENAME COLUMN counts TO weight;

ALTER TABLE proposal_items ADD COLUMN counts TEXT CHECK (counts IN ('presumed', 'passing', 'clear', 'concrete'));
UPDATE proposal_items SET counts = weight;
ALTER TABLE proposal_items DROP COLUMN weight;
ALTER TABLE proposal_items RENAME COLUMN counts TO weight;
