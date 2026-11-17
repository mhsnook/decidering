import { createFileRoute } from '@tanstack/react-router'
import { useTracker } from '../lib/tracker.tsx'
import { Syncing } from '../components/bits.tsx'
import { QuestionCard } from '../components/QuestionCard.tsx'

export const Route = createFileRoute('/questions')({ component: Questions })

function Questions() {
  const { tracker, isReady } = useTracker()
  if (!isReady) return <Syncing />
  const bodies = [...tracker.bodies].sort((a, b) => Number(a.is_demo) - Number(b.is_demo) || a.sort - b.sort)

  return (
    <div className="space-y-12">
      <h1 className="text-[32px] leading-none font-black sm:text-[40px]">Questions</h1>
      {bodies.map((body) => {
        const questions = tracker.questions.filter((q) => q.body_id === body.id && !q.parent_id).sort((a, b) => a.sort - b.sort)
        return (
          <section key={body.id}>
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-2xl font-extrabold">{body.name}</h2>
              {body.is_demo && <span className="tag rounded-full border-2 border-dashed border-ink px-2.5 py-0.5">Demo data, not real</span>}
              <p className="w-full text-muted">{body.description}</p>
            </div>
            <ul className="grid gap-6 md:grid-cols-2">
              {questions.map((question) => (
                <li key={question.id}>
                  <QuestionCard question={question} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
