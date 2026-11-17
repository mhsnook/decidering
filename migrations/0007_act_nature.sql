-- An act's kind used to mix what it was (a statement, a formal act, a vote)
-- with where it was said (an interview, a post, a platform). Sources now
-- record the where. The kind becomes how much the act binds:
--   says     words, in any medium
--   commits  a formal, public, revocable commitment: cosponsoring, signing, pledging
--   does     using the office itself: voting, scheduling, ratifying

UPDATE sources SET kind = 'social_post'
WHERE kind IS NULL AND id IN (SELECT r.source_id FROM reports r JOIN acts a ON a.id = r.act_id WHERE a.kind = 'social');
UPDATE sources SET kind = 'transcript'
WHERE kind IS NULL AND id IN (SELECT r.source_id FROM reports r JOIN acts a ON a.id = r.act_id WHERE a.kind = 'interview');

-- The old column carries a CHECK listing the old kinds, which SQLite cannot
-- alter, so the new values go in a new column that then takes its name.
ALTER TABLE acts ADD COLUMN nature TEXT NOT NULL DEFAULT 'says' CHECK (nature IN ('says', 'commits', 'does'));
UPDATE acts SET nature = CASE kind WHEN 'formal_act' THEN 'commits' WHEN 'vote' THEN 'does' ELSE 'says' END;
ALTER TABLE acts DROP COLUMN kind;
ALTER TABLE acts RENAME COLUMN nature TO kind;

ALTER TABLE proposal_items ADD COLUMN nature TEXT NOT NULL DEFAULT 'says' CHECK (nature IN ('says', 'commits', 'does'));
UPDATE proposal_items SET nature = CASE kind WHEN 'formal_act' THEN 'commits' WHEN 'vote' THEN 'does' ELSE 'says' END;
ALTER TABLE proposal_items DROP COLUMN kind;
ALTER TABLE proposal_items RENAME COLUMN nature TO kind;

-- A commitment can be taken back. A statement cannot be unsaid and a vote
-- cannot be uncast; those are answered by a later act.
ALTER TABLE acts ADD COLUMN withdrawn_on TEXT;

-- How an act bears on the question it is read on. A vote on the bill itself is
-- direct. A vote on something else that tells you about this question is
-- indirect, and counts as a signal, not as being on the record here.
ALTER TABLE readings ADD COLUMN bearing TEXT NOT NULL DEFAULT 'direct' CHECK (bearing IN ('direct', 'indirect'));
ALTER TABLE proposal_items ADD COLUMN bearing TEXT NOT NULL DEFAULT 'direct' CHECK (bearing IN ('direct', 'indirect'));

-- What doing the thing a sub-question asks about says on its parent. It was a
-- yes/no that could only mean support, so a letter against a policy had no
-- way to count against it.
ALTER TABLE questions ADD COLUMN implies_on_parent TEXT CHECK (implies_on_parent IN ('support', 'lean_support', 'mixed', 'lean_oppose', 'oppose'));
UPDATE questions SET implies_on_parent = 'support' WHERE implies_parent_support = 1;
ALTER TABLE questions DROP COLUMN implies_parent_support;
