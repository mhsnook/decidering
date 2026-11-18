import { Link } from '@tanstack/react-router'
import type { Body, Question } from '../../shared/schema.ts'
import { isHeld, useTracker } from '../lib/tracker.tsx'
import { TallyBar, tally } from './bits.tsx'

// `via` is the body to show the question through, for one put to several.
// Left out, it is the body the question is listed under.
export function QuestionCard({ question, body: via }: { question: Question; body?: Body }) {
  const { tracker } = useTracker()
  const body = via ?? tracker.bodyById.get(question.body_id)
  const rows = tracker.board(question, body?.id).filter(isHeld)
  return (
    <Link to="/q/$slug" params={{ slug: question.slug }} search={{ body: body && body.id !== question.body_id ? body.slug : undefined }} className="card block h-full p-[18px] transition-transform hover:-translate-y-0.5 sm:p-[22px]">
      <p className="tag flex justify-between gap-3">
        <span>
          {body?.name}
          {body?.is_demo && ' · demo'}
        </span>
        <span className="whitespace-nowrap">{rows.length} seats</span>
      </p>
      <h3 className="h-card mt-3 mb-3.5">{question.title}</h3>
      <TallyBar counts={tally(rows.map((r) => r.incumbent.standing))} question={question} />
    </Link>
  )
}
