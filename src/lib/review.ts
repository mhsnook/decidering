import { createTransaction } from '@tanstack/db'
import { stanceId, type EvidenceKind, type Position, type Submission } from '../../shared/schema.ts'
import { db, persist } from './db.ts'

export type Verdict = {
  quote: string
  kind: EvidenceKind
  signals: Position
  occurred_on: string
  source_title: string | null
  position: Position
  summary: string | null
  review_note: string | null
}

// One transaction, so the evidence, the stance it moves and the closed
// submission reach every reader together or not at all.
export function approve(submission: Submission, verdict: Verdict) {
  const now = new Date().toISOString()
  const id = stanceId(submission.question_id, submission.decider_id)
  const tx = createTransaction({ mutationFn: persist })
  tx.mutate(() => {
    db.evidence.insert({
      id: crypto.randomUUID(),
      question_id: submission.question_id,
      decider_id: submission.decider_id,
      kind: verdict.kind,
      signals: verdict.signals,
      quote: verdict.quote,
      source_url: submission.source_url,
      source_title: verdict.source_title,
      occurred_on: verdict.occurred_on,
      submission_id: submission.id,
      created_at: now,
    })
    if (db.stances.has(id)) {
      db.stances.update(id, (s) => {
        s.position = verdict.position
        s.summary = verdict.summary
        s.updated_at = now
      })
    } else {
      db.stances.insert({
        id,
        question_id: submission.question_id,
        decider_id: submission.decider_id,
        position: verdict.position,
        summary: verdict.summary,
        updated_at: now,
      })
    }
    db.submissions.update(submission.id, (s) => {
      s.status = 'approved'
      s.review_note = verdict.review_note
      s.reviewed_at = now
    })
  })
  return tx.isPersisted.promise
}

export function reject(submission: Submission, review_note: string | null) {
  return db.submissions.update(submission.id, (s) => {
    s.status = 'rejected'
    s.review_note = review_note
    s.reviewed_at = new Date().toISOString()
  }).isPersisted.promise
}
