import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { EVIDENCE_KINDS, POSITIONS, stanceId, type Submission } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { editorFetch, isEditor, signIn, signOut } from '../lib/editor.ts'
import { approve, reject, type Verdict } from '../lib/review.ts'
import { useTracker } from '../lib/tracker.tsx'
import { KIND_LABEL, SIGNAL_LABEL, formatDate, standingLabel } from '../lib/position.ts'
import { StandingPill, Syncing } from '../components/bits.tsx'
import { EvidenceItem } from '../components/EvidenceList.tsx'

export const Route = createFileRoute('/editor')({ component: Editor })

function Editor() {
  return isEditor() ? <Queue /> : <SignIn />
}

function SignIn() {
  const [failed, setFailed] = useState(false)
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const token = new FormData(e.currentTarget).get('token') as string
    setFailed(!(await signIn(token)))
  }
  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-sm space-y-4 py-12">
      <h1 className="text-2xl font-semibold">Editors</h1>
      <div>
        <label className="label" htmlFor="token">
          Editor token
        </label>
        <input id="token" name="token" type="password" required autoComplete="current-password" className="field" />
      </div>
      {failed && <p className="text-sm text-oppose">That token was not accepted.</p>}
      <button className="btn btn-primary">Sign in</button>
    </form>
  )
}

function Queue() {
  const { tracker, isReady } = useTracker()
  const submissions = useLiveQuery((q) => q.from({ row: db.submissions }))
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const pending = submissions.data.filter((s) => s.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const reviewed = submissions.data
    .filter((s) => s.status !== 'pending')
    .sort((a, b) => (b.reviewed_at ?? '').localeCompare(a.reviewed_at ?? ''))
  const list = tab === 'pending' ? pending : reviewed
  const selected = list.find((s) => s.id === selectedId) ?? list[0]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      const i = list.findIndex((s) => s.id === selected?.id)
      if (e.key === 'j' && list[i + 1]) setSelectedId(list[i + 1].id)
      else if (e.key === 'k' && list[i - 1]) setSelectedId(list[i - 1].id)
      else if (e.key === 'o' && selected) window.open(selected.source_url, '_blank', 'noreferrer')
      else if (e.key === 'a' && tab === 'pending') document.getElementById('approve')?.click()
      else if (e.key === 'r' && tab === 'pending') document.getElementById('reject')?.click()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!isReady) return <Syncing />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Review queue</h1>
        <div className="flex items-center gap-2">
          <NewsSearchButton />
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-line">
        {(['pending', 'reviewed'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${tab === t ? 'border-ink' : 'border-transparent text-muted'}`}
          >
            {t} <span className="tabular-nums">{t === 'pending' ? pending.length : reviewed.length}</span>
          </button>
        ))}
        <p className="ml-auto hidden gap-3 pb-1 text-xs text-muted md:flex">
          <span>
            <kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> move
          </span>
          <span>
            <kbd className="kbd">o</kbd> open source
          </span>
          <span>
            <kbd className="kbd">a</kbd> approve
          </span>
          <span>
            <kbd className="kbd">r</kbd> reject
          </span>
        </p>
      </div>

      {list.length === 0 ? (
        <p className="py-16 text-center text-muted">{tab === 'pending' ? 'The queue is clear.' : 'Nothing reviewed yet.'}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-lg border p-3 text-left ${s.id === selected?.id ? 'border-ink bg-surface' : 'border-transparent hover:bg-surface'}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {tracker.deciderById.get(s.decider_id)?.name ?? s.decider_id}
                    {s.status !== 'pending' && <span className={`text-xs ${s.status === 'approved' ? 'text-support' : 'text-muted'}`}>{s.status}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{tracker.questionById.get(s.question_id)?.short_title}</span>
                  <span className="mt-1 line-clamp-2 text-xs">{s.quote}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <Review key={selected.id} submission={selected} />}
        </div>
      )}
    </div>
  )
}

function Review({ submission }: { submission: Submission }) {
  const { tracker } = useTracker()
  const [error, setError] = useState<string | null>(null)
  const question = tracker.questionById.get(submission.question_id)
  const decider = tracker.deciderById.get(submission.decider_id)
  if (!question || !decider) return <p className="text-muted">This submission points at a question or person that no longer exists.</p>

  const stance = tracker.stanceById.get(stanceId(question.id, decider.id))
  const existing = tracker.evidenceFor(question, decider.id)
  const isPending = submission.status === 'pending'

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (name: string) => (f.get(name) as string).trim()
    const action = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value
    const review_note = text('review_note') || null
    setError(null)
    const done =
      action === 'reject'
        ? reject(submission, review_note)
        : approve(submission, {
            quote: text('quote'),
            kind: f.get('kind') as Verdict['kind'],
            signals: f.get('signals') as Verdict['signals'],
            occurred_on: text('occurred_on'),
            source_title: text('source_title') || null,
            position: f.get('position') as Verdict['position'],
            summary: text('summary') || null,
            review_note,
          })
    done.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{decider.name}</h2>
            <p className="text-sm text-muted">{question.title}</p>
          </div>
          <span className="rounded bg-paper px-2 py-1 text-xs text-muted">
            {submission.origin === 'news_search' ? 'Found by news search' : 'Sent in by a reader'} · {formatDate(submission.created_at)}
          </span>
        </div>
        <a href={submission.source_url} target="_blank" rel="noreferrer" className="mt-3 block text-sm break-all text-accent underline underline-offset-2">
          {submission.source_url} ↗
        </a>
        {submission.submitter_note && <p className="mt-3 rounded bg-paper p-3 text-sm">Note: {submission.submitter_note}</p>}
      </div>

      <fieldset disabled={!isPending} className="space-y-4">
        <div>
          <label className="label" htmlFor="quote">
            Quote or act, as it will be published
          </label>
          <textarea id="quote" name="quote" required rows={4} defaultValue={submission.quote} className="field" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="source_title">
              Source name
            </label>
            <input id="source_title" name="source_title" defaultValue={submission.source_title ?? ''} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="occurred_on">
              Date it happened
            </label>
            <input id="occurred_on" name="occurred_on" type="date" required defaultValue={submission.occurred_on ?? ''} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="kind">
              Kind
            </label>
            <select id="kind" name="kind" defaultValue={submission.kind} className="field">
              {EVIDENCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="signals">
              This item shows
            </label>
            <select id="signals" name="signals" required defaultValue={submission.signals ?? ''} className="field">
              <option value="" disabled>
                Choose…
              </option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {SIGNAL_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-line p-4">
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            Currently listed as <StandingPill standing={stance?.position ?? 'unknown'} question={question} /> on {existing.length} item
            {existing.length === 1 ? '' : 's'}.
          </p>
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <div>
              <label className="label" htmlFor="position">
                Position after approving
              </label>
              <select id="position" name="position" required defaultValue={stance?.position ?? submission.signals ?? ''} className="field">
                <option value="" disabled>
                  Choose…
                </option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {standingLabel(p, question)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="summary">
                One-line summary
              </label>
              <input id="summary" name="summary" defaultValue={stance?.summary ?? ''} className="field" />
            </div>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="review_note">
            Review note <span className="font-normal normal-case">(internal)</span>
          </label>
          <input id="review_note" name="review_note" defaultValue={submission.review_note ?? ''} className="field" />
        </div>

        {isPending && (
          <div className="flex gap-2">
            <button id="approve" name="action" value="approve" className="btn btn-primary">
              Approve and publish
            </button>
            <button id="reject" name="action" value="reject" formNoValidate className="btn">
              Reject
            </button>
          </div>
        )}
        {error && <p className="text-sm text-oppose">Not saved: {error}</p>}
      </fieldset>

      {existing.length > 0 && (
        <section>
          <h3 className="mb-2 text-base font-semibold">Already on the record</h3>
          <ol className="space-y-2">
            {existing.map((e) => (
              <EvidenceItem key={e.id} evidence={e} question={question} />
            ))}
          </ol>
        </section>
      )}
    </form>
  )
}

function NewsSearchButton() {
  const [state, setState] = useState<'idle' | 'running' | string>('idle')
  async function run() {
    setState('running')
    try {
      const res = await editorFetch('/api/editor/news-search', { method: 'POST' })
      const report = (await res.json()) as { error?: string; questions: { queued: number }[] }
      setState(report.error ?? `${report.questions.reduce((n, q) => n + q.queued, 0)} new leads queued`)
    } catch {
      setState('News search failed')
    }
  }
  return (
    <>
      {state !== 'idle' && state !== 'running' && <span className="text-xs text-muted">{state}</span>}
      <button type="button" className="btn" onClick={run} disabled={state === 'running'} title="Searches the news for questions marked as in the news">
        {state === 'running' ? 'Searching…' : 'Search the news now'}
      </button>
    </>
  )
}
