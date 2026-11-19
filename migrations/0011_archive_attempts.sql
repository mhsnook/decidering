-- One row per source the archiving pass has worked on, so a source the
-- Wayback Machine cannot capture is not asked about on every run. Not synced
-- to browsers.
--
-- source_id is not a foreign key so that deleting or merging a source is never
-- blocked by its archiving history.
CREATE TABLE archive_attempts (
  source_id TEXT PRIMARY KEY,
  -- Failures in a row. Reset when a capture is stored.
  attempts INTEGER NOT NULL DEFAULT 0,
  tried_at TEXT NOT NULL,
  -- archived: a capture's address was stored in sources.archive_url
  -- requested: Save Page Now accepted a capture job; the next run looks for it
  -- failed: no capture yet; tried again from next_try_at
  -- no_key: no capture was found and the Worker has no key to ask for one
  -- gave_up: the archive refused the page, or it failed too many times
  outcome TEXT NOT NULL CHECK (outcome IN ('archived', 'requested', 'failed', 'no_key', 'gave_up')),
  -- NULL: the scheduled pass does not pick it up again.
  next_try_at TEXT,
  job_id TEXT,
  detail TEXT
);
CREATE INDEX archive_attempts_next ON archive_attempts(next_try_at);
