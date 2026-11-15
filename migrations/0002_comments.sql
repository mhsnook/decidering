CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  -- "<question_id>:<decider_id>", the same key a stance uses
  thread_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX comments_thread ON comments(thread_id, created_at);
