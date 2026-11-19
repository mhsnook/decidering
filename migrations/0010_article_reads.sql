-- One row per article the news search has looked at for a question, whatever
-- came of it, so a later run does not fetch it or send it to the model again.
-- Not synced to browsers.
CREATE TABLE article_reads (
  url TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  read_at TEXT NOT NULL,
  -- queued: acts were found and queued
  -- no_acts: the model read it and found nothing that survived the quote check
  -- not_read: the article could not be fetched, or the model failed; the search excerpt was queued instead
  outcome TEXT NOT NULL CHECK (outcome IN ('queued', 'no_acts', 'not_read')),
  model TEXT,
  detail TEXT,
  PRIMARY KEY (url, question_id)
);
