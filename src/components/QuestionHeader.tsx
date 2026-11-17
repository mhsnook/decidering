import { Link } from '@tanstack/react-router'
import type { Question } from '../../shared/schema.ts'
import { useTracker } from '../lib/tracker.tsx'
import { Eyebrow } from './bits.tsx'

// The broad question and its specific measures are one family; the tabs move
// between them without leaving the page you're on.
export function QuestionHeader({ question, deciderSlug }: { question: Question; deciderSlug?: string }) {
  const { tracker } = useTracker()
  const body = tracker.bodies.find((b) => b.id === question.body_id)
  const root = question.parent_id ? (tracker.questionById.get(question.parent_id) ?? question) : question
  // An ask is put to named people, so its tab only appears where it applies:
  // on those people's pages, and on the ask's own page.
  const deciderId = deciderSlug && tracker.deciderBySlug.get(deciderSlug)?.id
  const asks = (tracker.asksOf.get(root.id) ?? []).filter((a) => a.id === question.id || (deciderId && tracker.appliesTo(a, deciderId)))
  const family = [root, ...(tracker.measuresOf.get(root.id) ?? []), ...asks]

  return (
    <header className="space-y-3">
      <Eyebrow>
        {body?.name}
        {body?.is_demo && ' · demo data, not real'}
      </Eyebrow>
      <h1 className="max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">{question.title}</h1>
      {question.description && <p className="max-w-2xl text-muted">{question.description}</p>}
      {question.reference_url && (
        <a href={question.reference_url} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent underline underline-offset-2">
          Read the measure ↗
        </a>
      )}
      {family.length > 1 && (
        <nav className="flex flex-wrap gap-2 pt-1" aria-label="Related questions">
          {family.map((q) => {
            const className = `rounded-full border px-3 py-1 text-sm ${q.id === question.id ? 'border-ink bg-ink text-paper' : 'border-line bg-surface hover:border-ink'}`
            const label = q.id === root.id ? `In general` : q.short_title
            return deciderSlug ? (
              <Link key={q.id} to="/q/$slug/$decider" params={{ slug: q.slug, decider: deciderSlug }} className={className}>
                {label}
              </Link>
            ) : (
              <Link key={q.id} to="/q/$slug" params={{ slug: q.slug }} className={className}>
                {label}
              </Link>
            )
          })}
        </nav>
      )}
    </header>
  )
}
