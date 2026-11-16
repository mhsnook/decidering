import { Link, createFileRoute } from '@tanstack/react-router'
import { useTracker } from '../lib/tracker.tsx'
import { Eyebrow, Syncing, TallyBar, tally } from '../components/bits.tsx'
import { NEEDS_ATTENTION } from '../../shared/standing.ts'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { tracker, isReady } = useTracker()
  if (!isReady) return <Syncing />
  const bodies = [...tracker.bodies].sort((a, b) => Number(a.is_demo) - Number(b.is_demo) || a.sort - b.sort)

  return (
    <div className="space-y-12">
      <section className="max-w-2xl">
        <h1 className="text-4xl leading-tight font-semibold sm:text-5xl">Who has decided what, and how we know.</h1>
        <p className="mt-4 text-lg text-muted">
          Open questions in front of the people who get to decide them. Each position is tied to something they said or did, with the date, so you can
          see what is solid, what is thin, and what nobody has asked yet.
        </p>
      </section>

      {bodies.map((body) => {
        const questions = tracker.questions.filter((q) => q.body_id === body.id && !q.parent_id).sort((a, b) => a.sort - b.sort)
        return (
          <section key={body.id}>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-2xl font-semibold">{body.name}</h2>
              {body.is_demo && <span className="rounded bg-mixed/20 px-1.5 py-0.5 text-xs font-semibold text-accent">Demo data, not real</span>}
              <p className="w-full text-sm text-muted">{body.description}</p>
            </div>
            <ul className="grid gap-4 md:grid-cols-2">
              {questions.map((question) => {
                const rows = tracker.board(question).filter((r) => r.incumbent)
                const thin = rows.filter((r) => NEEDS_ATTENTION.has(r.incumbent!.footing)).length
                const measures = tracker.childrenOf.get(question.id) ?? []
                return (
                  <li key={question.id}>
                    <Link
                      to="/q/$slug"
                      params={{ slug: question.slug }}
                      className="block rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink"
                    >
                      {question.is_hot && <Eyebrow>In the news</Eyebrow>}
                      <h3 className="mt-1 text-xl font-semibold">{question.title}</h3>
                      <p className="mt-1 mb-4 line-clamp-2 text-sm text-muted">{question.description}</p>
                      <TallyBar counts={tally(rows.map((r) => r.incumbent!.standing))} question={question} />
                      <p className="mt-3 text-xs text-muted">
                        {rows.length} seats · {thin} with thin or no evidence
                        {measures.length > 0 && ` · tracks ${measures.map((m) => m.short_title).join(', ')}`}
                      </p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
