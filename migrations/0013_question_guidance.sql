-- What editors have told the librarian about how to read a question. Each row
-- is one note, given to the model with every article read for that question.
-- Only sent to editors.
CREATE TABLE question_guidance (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX question_guidance_question ON question_guidance(question_id);
