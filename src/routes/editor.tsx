import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { EVIDENCE_KINDS, POSITIONS, stanceId, type Position, type Submission } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { editorFetch, isEditor, signIn, signOut } from '../lib/editor.ts'
import { approve, reject, type Verdict } from '../lib/review.ts'
import { useTracker } from '../lib/tracker.tsx'
import { KIND_LABEL, formatDate, standingLabel } from '../lib/position.ts'
import { Syncing, Token } from '../components/bits.tsx'
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
    <form onSubmit={onSubmit} className="card mx-auto mt-8 max-w-sm space-y-4 p-6">
      <h1 className="text-[28px] font-black">Editors</h1>
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

// How many waiting items to list beside the open one.
const UP_NEXT = 12

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
  const others = list.filter((s) => s.id !== selected?.id)

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

  const total = pending.length + reviewed.length
  const tabClass = (t: typeof tab) => (tab === t ? 'font-black' : 'link cursor-pointer font-semibold')

  return (
    <div className="pb-24 sm:pb-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <h1 className="text-[32px] leading-none font-black sm:text-[40px]">Review queue</h1>
        <div
          className="h-3.5 min-w-[200px] flex-1 overflow-hidden rounded-full border-2 border-ink bg-surface sm:h-[18px]"
          role="progressbar"
          aria-label="Reviewed"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={reviewed.length}
        >
          <div className="h-full bg-support transition-[width] duration-300" style={{ width: `${total ? (reviewed.length / total) * 100 : 0}%` }} />
        </div>
        <p className="tabular-nums">
          <button type="button" aria-pressed={tab === 'reviewed'} className={tabClass('reviewed')} onClick={() => setTab('reviewed')}>
            {reviewed.length} reviewed
          </button>
          {' · '}
          <button type="button" aria-pressed={tab === 'pending'} className={tabClass('pending')} onClick={() => setTab('pending')}>
            {pending.length} to go
          </button>
        </p>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <NewsSearchButton />
          <button type="button" className="btn rounded-full py-1.5 text-[15px] font-semibold shadow-none" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {!selected ? (
        <div className="card mt-10 bg-mint px-5 py-7 text-center sm:mt-12 sm:rounded-3xl sm:p-12">
          <h2 className="text-2xl font-black sm:text-[32px]">{tab === 'pending' ? 'The queue is empty.' : 'Nothing reviewed yet.'}</h2>
          {tab === 'pending' && <p className="mt-2 text-[15px] sm:text-[17px]">Every lead has been reviewed. The next news search runs in a few hours.</p>}
        </div>
      ) : (
        <div className="mt-6 grid items-start gap-9 sm:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
          <Review key={selected.id} submission={selected} behind={others.length} />
          {others.length > 0 && (
            <aside>
              <h2 className="mb-2.5 text-base font-black sm:text-lg">{tab === 'pending' ? 'Up next' : 'Reviewed'}</h2>
              <ul className="flex flex-col gap-2 sm:gap-2.5">
                {others.slice(0, UP_NEXT).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className="flex w-full cursor-pointer items-start gap-3 rounded-[14px] border-2 border-ink bg-surface px-3.5 py-3 text-left hover:shadow-[0_4px_0_var(--color-ink)]"
                    >
                      <Token standing={tracker.stanceById.get(stanceId(s.question_id, s.decider_id))?.position ?? 'unknown'} className="mt-0.5 size-[22px]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2 font-bold">
                          {tracker.deciderById.get(s.decider_id)?.name ?? s.decider_id}
                          {s.status !== 'pending' && <span className="tag">{s.status}</span>}
                        </span>
                        <span className="mt-0.5 line-clamp-1 text-sm leading-snug text-muted sm:line-clamp-2">{s.quote}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {others.length > UP_NEXT && <p className="mt-3 text-sm font-semibold text-muted">and {others.length - UP_NEXT} more</p>}
              <p className="tag mt-4 hidden text-[13px] leading-[1.8] font-medium text-faint lg:block">
                J / K move · O open source
                <br />A approve · R reject
              </p>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}

const PICKED: Record<Position, string> = {
  support: 'has-checked:bg-support/20',
  lean_support: 'has-checked:bg-lean-support/40',
  mixed: 'has-checked:bg-mixed/30',
  lean_oppose: 'has-checked:bg-lean-oppose/40',
  oppose: 'has-checked:bg-oppose/15',
}

function Review({ submission, behind }: { submission: Submission; behind: number }) {
  const { tracker } = useTracker()
  const [error, setError] = useState<string | null>(null)
  const question = tracker.questionById.get(submission.question_id)
  const decider = tracker.deciderById.get(submission.decider_id)
  if (!question || !decider) return <p className="text-muted">This submission points at a question or person that no longer exists.</p>

  const stance = tracker.stanceById.get(stanceId(question.id, decider.id))
  const existing = tracker.evidenceFor(question, decider.id)
  const isPending = submission.status === 'pending'
  const fromSearch = submission.origin === 'news_search'

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (name: string) => (f.get(name) as string).trim()
    const action = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value
    const review_note = text('review_note') || null
    const signals = f.get('signals') as Verdict['signals']
    setError(null)
    const done =
      action === 'reject'
        ? reject(submission, review_note)
        : approve(submission, {
            quote: text('quote'),
            kind: f.get('kind') as Verdict['kind'],
            signals,
            occurred_on: text('occurred_on'),
            source_title: text('source_title') || null,
            position: (f.get('position') as Verdict['position'] | '') || signals,
            summary: text('summary') || null,
            review_note,
          })
    done.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div>
      <div className="relative mr-2 sm:mr-3">
        {behind > 1 && <div className="absolute inset-0 translate-x-2 translate-y-3 rounded-[20px] border-2 border-ink bg-surface sm:translate-x-3 sm:translate-y-4 sm:rounded-3xl" />}
        {behind > 0 && <div className="absolute inset-0 translate-x-1 translate-y-1.5 rounded-[20px] border-2 border-ink bg-surface sm:translate-x-1.5 sm:translate-y-2 sm:rounded-3xl" />}
        <form onSubmit={onSubmit} className="relative flex flex-col gap-4 rounded-[20px] border-2 border-ink bg-surface p-[18px] sm:gap-5 sm:rounded-3xl sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-3.5">
              <Token
                standing={stance?.position ?? 'unknown'}
                className={`size-10 border-[3px] sm:size-[52px] ${stance ? 'shadow-[0_3px_0_var(--color-ink)] sm:shadow-[0_4px_0_var(--color-ink)]' : ''}`}
              />
              <div>
                <h2 className="text-[22px] leading-[1.1] font-black sm:text-[28px]">{decider.name}</h2>
                <p className="mt-1 text-sm text-muted sm:text-base">{question.title}</p>
              </div>
            </div>
            <span className="tag rounded-full border-2 border-dashed border-ink px-2.5 py-1 text-[11px] sm:text-xs">
              {fromSearch ? 'News search' : 'Sent in by a reader'} · {formatDate(submission.created_at)}
            </span>
          </div>

          <fieldset disabled={!isPending} className="flex min-w-0 flex-col gap-4 sm:gap-5">
            <div className="rounded-[14px] border-2 border-dashed border-line bg-paper px-3.5 py-3 sm:px-[18px] sm:py-4">
              <label className="tag text-[10px] text-faint sm:text-xs" htmlFor="quote">
                {fromSearch ? 'Search excerpt, not a checked quote' : 'Reader’s quote, not yet checked'}
              </label>
              <textarea id="quote" name="quote" required rows={3} defaultValue={submission.quote} className="field mt-2 leading-normal sm:text-lg" />
              <a href={submission.source_url} target="_blank" rel="noreferrer" className="link mt-2 flex min-h-11 items-center text-sm font-semibold break-all sm:min-h-0">
                {submission.source_url} ↗
              </a>
              {submission.submitter_note && <p className="mt-2 text-sm">Reader’s note: {submission.submitter_note}</p>}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="source_title">
                  Source
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
            </div>

            <div role="radiogroup" aria-labelledby="signals-label">
              <p className="mb-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm sm:mb-3">
                <span id="signals-label" className="font-bold">
                  What does this show?
                </span>
                <span className="text-[13px] font-medium text-faint sm:text-sm">
                  {stance ? `Now listed as ${standingLabel(stance.position, question)}, from ${existing.length} item${existing.length === 1 ? '' : 's'}` : 'Not listed yet'}
                </span>
              </p>
              <div className="grid grid-cols-5 gap-1.5 text-center text-[11px] leading-[1.15] font-bold sm:gap-2.5 sm:text-[15px]">
                {POSITIONS.map((p) => (
                  <label
                    key={p}
                    className={`flex min-h-[72px] cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-ink bg-surface px-0.5 pt-2.5 pb-2 transition-transform has-checked:-translate-y-[3px] has-checked:shadow-[0_4px_0_var(--color-ink)] has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent sm:gap-2 sm:rounded-[14px] sm:py-3 ${PICKED[p]}`}
                  >
                    <input type="radio" name="signals" value={p} required defaultChecked={submission.signals === p} className="sr-only" />
                    <Token standing={p} className="size-6 sm:size-7" />
                    {standingLabel(p, question)}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <div>
                <label className="label" htmlFor="position">
                  Listed as, after approving
                </label>
                <select id="position" name="position" defaultValue={stance?.position ?? ''} className="field">
                  <option value="">Same as this item</option>
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
                <input id="summary" name="summary" defaultValue={stance?.summary ?? ''} placeholder="Write one line…" className="field" />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="review_note">
                Review note <span className="font-normal text-faint">(only editors see this)</span>
              </label>
              <input id="review_note" name="review_note" defaultValue={submission.review_note ?? ''} placeholder="Add a note…" className="field" />
            </div>

            {isPending && (
              <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2.5 border-t-2 border-ink bg-surface px-4 pt-3 pb-5 sm:static sm:gap-3 sm:border-0 sm:p-0">
                <button id="approve" name="action" value="approve" className="btn btn-go order-2 min-h-[52px] flex-[2] rounded-[14px] shadow-[0_4px_0_var(--color-ink)] sm:order-1 sm:flex-1 sm:text-[17px]">
                  Approve and publish <span className="hidden sm:inline">[A]</span>
                </button>
                <button id="reject" name="action" value="reject" formNoValidate className="btn order-1 min-h-[52px] flex-1 rounded-[14px] shadow-[0_4px_0_var(--color-ink)] sm:order-2 sm:text-[17px]">
                  Reject <span className="hidden sm:inline">[R]</span>
                </button>
              </div>
            )}
            {error && <p className="text-sm font-semibold text-oppose">Not saved: {error}</p>}
          </fieldset>
        </form>
      </div>

      {existing.length > 0 && (
        <section className="mt-10">
          <h3 className="mb-2.5 text-base font-black sm:text-lg">Already on the record</h3>
          <ol className="space-y-2.5">
            {existing.map((e) => (
              <EvidenceItem key={e.id} evidence={e} question={question} />
            ))}
          </ol>
        </section>
      )}
    </div>
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
      {state !== 'idle' && state !== 'running' && <span className="text-sm font-semibold">{state}</span>}
      <button type="button" className="btn rounded-full py-1.5 text-[15px] font-semibold" onClick={run} disabled={state === 'running'} title="Searches the news for questions marked as in the news">
        {state === 'running' ? 'Searching…' : 'Search the news now'}
      </button>
    </>
  )
}
