-- How sure it is that someone holds a seat or an office over the dates given.
-- It belongs to the holding, not to the person: the same person can be certain
-- in the seat they have now and only possible in it after a recount.
--   certain   settled, or called
--   likely    expected, not settled: ahead in a recount, or due a chair
--   possible  one of those who may yet hold it: the other side of a recount,
--             or a candidate in a runoff
-- A seat or office is shown as held by its certain or likely holder. Possible
-- holders are shown beside them, never in their place.
ALTER TABLE roles ADD COLUMN certainty TEXT NOT NULL DEFAULT 'certain' CHECK (certainty IN ('certain', 'likely', 'possible'));
ALTER TABLE office_holders ADD COLUMN certainty TEXT NOT NULL DEFAULT 'certain' CHECK (certainty IN ('certain', 'likely', 'possible'));
