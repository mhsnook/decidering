import { Link } from '@tanstack/react-router'
import type { Question } from '../../shared/schema.ts'
import { isHeld, useTracker } from '../lib/tracker.tsx'
import { TallyBar, tally } from './bits.tsx'

export function QuestionCard({ question }: { question: Question }) {
  const { tracker } = useTracker()
  const body = tracker.bodies.find((b) => b.id === question.body_id)
  const rows = tracker.board(question).filter(isHeld)
  return (
    <Link to="/q/$slug" params={{ slug: question.slug }} className="card block h-full p-[18px] transition-transform hover:-translate-y-0.5 sm:p-[22px]">
      <p className="tag flex justify-between gap-3">
        <span>
          {body?.name}
          {body?.is_demo && ' · demo'}
        </span>
        <span className="whitespace-nowrap">{rows.length} seats</span>
      </p>
      <h3 className="mt-3 mb-3.5 text-[19px] leading-tight font-extrabold sm:text-[21px]">{question.title}</h3>
      <TallyBar counts={tally(rows.map((r) => r.incumbent.standing))} question={question} />
    </Link>
  )
}
