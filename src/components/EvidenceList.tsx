import type { Evidence, Question } from '../../shared/schema.ts'
import { useTracker } from '../lib/tracker.tsx'
import { KIND_LABEL, SIGNAL_LABEL, STANDING_BG, formatDate } from '../lib/position.ts'

const RECORDED = new Set(['formal_act', 'vote'])

export function EvidenceItem({ evidence, question }: { evidence: Evidence; question?: Question }) {
  const { tracker } = useTracker()
  const from = question && evidence.question_id !== question.id ? tracker.questionById.get(evidence.question_id) : undefined
  return (
    <li className="rounded-xl border-2 border-ink bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <time dateTime={evidence.occurred_on} className="font-semibold text-ink">
          {formatDate(evidence.occurred_on)}
        </time>
        <span>·</span>
        <span>{KIND_LABEL[evidence.kind]}</span>
        {from && <span className="rounded bg-paper px-1.5 py-0.5">{from.short_title}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${STANDING_BG[evidence.signals]}`} />
          {SIGNAL_LABEL[evidence.signals]}
        </span>
      </div>
      {RECORDED.has(evidence.kind) ? (
        <p>{evidence.quote}</p>
      ) : (
        <blockquote className="border-l-2 border-accent pl-3 font-display text-lg leading-snug">“{evidence.quote}”</blockquote>
      )}
      <a href={evidence.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm link">
        {evidence.source_title ?? new URL(evidence.source_url).hostname} ↗
      </a>
    </li>
  )
}
