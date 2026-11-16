-- Seats needed to carry the question, when that is not a simple majority of the
-- voting seats (38 of 50 states to ratify an amendment).
ALTER TABLE questions ADD COLUMN threshold INTEGER;
-- What a formal act is called once done ("Ratified"). NULL reads "Signed on".
ALTER TABLE questions ADD COLUMN act_label TEXT;
