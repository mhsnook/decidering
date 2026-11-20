import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { Proposal, ProposalContext, ProposalItem, ProposalMention, ProposalNote, Source } from '../../shared/schema.ts'
import { isAcross as isAcrossFrom } from '../../shared/standing.ts'
import { db } from '../lib/db.ts'
import { editorFetch, isEditor, signIn, signOut } from '../lib/editor.ts'
import { commit } from '../lib/review.ts'
import { planReview, type Write } from '../lib/review-plan.ts'
import { decisionOf, draftEntries, fallbackDate, outlook, relatedChoices, verdictOf, withWeight, type EntryDraft } from '../lib/review-form.ts'
import { useTracker } from '../lib/tracker.tsx'
import { sourceLabel } from '../lib/position.ts'
import { Syncing, Token } from '../components/bits.tsx'
import { Reveal } from '../components/review/Reveal.tsx'
import { ReviewCard, upNextLine } from '../components/review/ReviewCard.tsx'
import { Librarian, type LibrarianCard, type LibrarianChange } from '../components/review/Librarian.tsx'

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

// How many waiting proposals to list beside the open one.
const UP_NEXT = 12
// How long the open card takes to leave before the next one arrives.
const LEAVE_MS = 470
const TOAST_MS = 4200

type Finish = { writes: Write[]; how: 'publishing' | 'dismissing'; message: string }

function Queue() {
  const { tracker, isReady } = useTracker()
  const proposals = useLiveQuery((q) => q.from({ row: db.proposals }))
  const allItems = useLiveQuery((q) => q.from({ row: db.proposal_items }))
  const allNotes = useLiveQuery((q) => q.from({ row: db.proposal_notes }))
  const allContexts = useLiveQuery((q) => q.from({ row: db.proposal_contexts }))
  const allMentions = useLiveQuery((q) => q.from({ row: db.proposal_mentions }))
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<{ id: string; how: Finish['how'] } | null>(null)
  const [toast, setToast] = useState<{ text: string; shown: boolean }>({ text: '', shown: false })
  const [error, setError] = useState<string | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const itemsOf = (proposalId: string) => allItems.data.filter((i) => i.proposal_id === proposalId).sort((a, b) => a.sort - b.sort)
  // Whether anything a proposal claims sits across from a position editors set. Those are checked first.
  const isAcross = (proposalId: string) =>
    itemsOf(proposalId).some((i) => {
      const question = tracker.questionById.get(i.question_id)
      const set = question && tracker.listingFor(question, i.decider_id).set
      return i.status === 'pending' && i.reading !== null && set !== undefined && isAcrossFrom(set.position, i.reading)
    })
  const pending = proposals.data
    .filter((p) => p.status === 'pending')
    .map((p) => ({ p, across: isAcross(p.id) }))
    .sort((a, b) => Number(b.across) - Number(a.across) || a.p.created_at.localeCompare(b.p.created_at))
    .map(({ p }) => p)
  const reviewed = proposals.data.filter((p) => p.status !== 'pending').sort((a, b) => (b.reviewed_at ?? '').localeCompare(a.reviewed_at ?? ''))
  const list = tab === 'pending' ? pending : reviewed
  const selected = list.find((p) => p.id === selectedId) ?? list[0]
  const others = list.filter((p) => p.id !== selected?.id)
  const selectedSource = selected && tracker.sourceById.get(selected.source_id)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      const i = list.findIndex((p) => p.id === selected?.id)
      if (e.key === 'j' && list[i + 1]) setSelectedId(list[i + 1].id)
      else if (e.key === 'k' && list[i - 1]) setSelectedId(list[i - 1].id)
      else if (e.key === 'o' && selectedSource?.url) window.open(selectedSource.url, '_blank', 'noreferrer')
      else if (e.key === 'a' && tab === 'pending') document.getElementById('approve')?.click()
      else if (e.key === 'r' && tab === 'pending') document.getElementById('reject')?.click()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!isReady || !proposals.isReady || !allItems.isReady || !allNotes.isReady || !allContexts.isReady || !allMentions.isReady) return <Syncing />

  // The card leaves first. The writes go in once it is gone, which brings the next card up from the stack.
  function finish(proposalId: string, { writes, how, message }: Finish) {
    if (leaving) return
    setError(null)
    setLeaving({ id: proposalId, how })
    const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms))
    later(() => {
      commit(writes).catch((err: unknown) => {
        setToast((t) => ({ ...t, shown: false }))
        setError(err instanceof Error ? err.message : String(err))
      })
      setLeaving(null)
      setSelectedId(null)
      setToast({ text: message, shown: true })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      later(() => setToast((t) => ({ ...t, shown: false })), TOAST_MS)
    }, LEAVE_MS)
  }

  const total = pending.length + reviewed.length
  const tabClass = (t: typeof tab) => (tab === t ? 'font-black' : 'link cursor-pointer font-semibold')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <h1 className="h-page">Review queue</h1>
        <div
          className="h-3.5 min-w-[200px] flex-1 overflow-hidden rounded-full border-2 border-ink bg-surface sm:h-[18px]"
          role="progressbar"
          aria-label="Reviewed"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={reviewed.length}
        >
          <div className="h-full bg-support transition-[width] duration-[400ms]" style={{ width: `${total ? (reviewed.length / total) * 100 : 0}%` }} />
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
          <button type="button" className="btn btn-sm shadow-none" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <ReadArticleTrial />

      <Reveal open={toast.shown}>
        <p role="status" className="mt-5 rounded-xl border-2 border-ink bg-mint px-3.5 py-2.5 font-bold">
          {toast.text}
        </p>
      </Reveal>
      {error && <p className="mt-5 rounded-xl border-2 border-ink bg-oppose/15 px-3.5 py-2.5 font-bold">Not saved: {error}</p>}

      {!selected || !selectedSource ? (
        <div className="card card-lg mt-10 bg-mint px-5 py-7 text-center sm:mt-12 sm:p-12">
          <h2 className="text-2xl font-black sm:text-[32px]">{!selected ? (tab === 'pending' ? 'The queue is empty.' : 'Nothing reviewed yet.') : 'This proposal points at a source that no longer exists.'}</h2>
          {!selected && tab === 'pending' && <p className="mt-2 text-[15px] sm:text-[17px]">Every lead has been reviewed. The news search runs once a day.</p>}
        </div>
      ) : (
        <Desk
          key={selected.id}
          proposal={selected}
          source={selectedSource}
          items={itemsOf(selected.id)}
          notes={allNotes.data.filter((n) => n.proposal_id === selected.id)}
          contexts={allContexts.data.filter((c) => c.proposal_id === selected.id)}
          mentions={allMentions.data.filter((m) => m.proposal_id === selected.id)}
          behind={others.length}
          leaving={leaving?.id === selected.id ? leaving.how : null}
          onFinish={(done) => finish(selected.id, done)}
        >
          {others.length > 0 && (
            <>
              <h2 className="text-base font-black sm:text-lg">{tab === 'pending' ? 'Up next' : 'Reviewed'}</h2>
              <ul className="flex flex-col gap-2 sm:gap-2.5">
                {others.slice(0, UP_NEXT).map((p) => {
                  const items = itemsOf(p.id)
                  const names = [...new Set(items.map((i) => tracker.deciderById.get(i.decider_id)?.name ?? i.decider_id))]
                  const accepted = items.filter((i) => i.status === 'accepted').length
                  const across = p.status === 'pending' && isAcross(p.id)
                  const unread = p.origin === 'news_search' && items.every((i) => i.reading === null)
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-[14px] border-ink bg-surface px-3.5 py-3 text-left hover:shadow-hard-md ${across ? 'border-[3px]' : unread ? 'border-2 border-dashed' : 'border-2'}`}
                      >
                        <Token standing={items.find((i) => i.reading)?.reading ?? 'unknown'} className="mt-0.5 size-[22px]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2 font-bold">
                            <span className="truncate">{names.join(', ')}</span>
                            {p.status !== 'pending' && (
                              <span className="tag shrink-0">{accepted === 0 ? 'dismissed' : accepted === items.length ? 'published' : `${accepted} of ${items.length} published`}</span>
                            )}
                          </span>
                          <span className="mt-0.5 line-clamp-1 text-sm leading-snug text-muted sm:line-clamp-2">{upNextLine(tracker.sourceById.get(p.source_id), p, items, across)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {others.length > UP_NEXT && <p className="text-sm font-semibold text-muted">and {others.length - UP_NEXT} more</p>}
            </>
          )}
          <p className="tag mt-1.5 hidden text-[13px] leading-[1.8] font-medium text-faint lg:block">
            J / K move · O open source
            <br />A publish · R dismiss all
          </p>
        </Desk>
      )}
    </div>
  )
}

// The open card and what sits beside it. It holds what the editor has changed
// on the card, none of which is written anywhere until the card is published.
function Desk({
  proposal,
  source,
  items,
  notes,
  contexts,
  mentions,
  behind,
  leaving,
  onFinish,
  children,
}: {
  proposal: Proposal
  source: Source
  items: ProposalItem[]
  notes: ProposalNote[]
  contexts: ProposalContext[]
  mentions: ProposalMention[]
  behind: number
  leaving: Finish['how'] | null
  onFinish: (done: Finish) => void
  children: ReactNode
}) {
  const { tracker } = useTracker()
  const readOnly = proposal.status !== 'pending'
  const [drafts, setDrafts] = useState(() =>
    draftEntries(items, fallbackDate(proposal, source)).map((d) => ({ ...d, note: notes.find((n) => n.kind === 'review' && d.items.some((i) => i.id === n.proposal_item_id))?.body ?? '' })),
  )
  const [reviewNote, setReviewNote] = useState(notes.find((n) => n.kind === 'review' && !n.proposal_item_id)?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [changingKey, setChangingKey] = useState<string | null>(null)
  const firstQuestion = drafts[0] && tracker.questionById.get(drafts[0].question_id)
  const rootQuestion = firstQuestion && ((firstQuestion.parent_id && tracker.questionById.get(firstQuestion.parent_id)) || firstQuestion)

  const librarianCard = (): LibrarianCard => ({
    source_title: source.title,
    entries: drafts
      .filter((d) => !d.dismissed && d.decider_id)
      .map((d) => ({
        key: d.key,
        name: tracker.deciderById.get(d.decider_id!)?.name ?? d.decider_id!,
        words: d.quote.slice(0, 2000),
        passage: d.passage?.slice(0, 2000) ?? null,
        reading: d.reading,
        weight: d.weight,
        related: Object.entries(d.related).flatMap(([question_id, reading]) => (reading ? [{ question_id, reading }] : [])),
      })),
    related_questions: [...new Map(drafts.flatMap((d) => relatedChoices(tracker, d)).map((c) => [c.question.id, { question_id: c.question.id, title: c.question.title, kind: c.kind }])).values()].slice(0, 20),
  })

  // The entry is outlined for a moment before it changes, so the eye finds it.
  function applyChanges(changes: LibrarianChange[]) {
    setChangingKey(changes[0].entry_key)
    setTimeout(() => {
      setChangingKey(null)
      setDrafts((all) =>
        all.map((d) => {
          const change = changes.find((c) => c.entry_key === d.key)
          if (!change) return d
          const related = { ...d.related }
          const added: string[] = []
          for (const r of change.related) {
            related[r.question_id] = r.reading === 'none' ? null : r.reading
            if (r.reading !== 'none') added.push(r.question_id)
          }
          const reading = change.reading ?? d.reading
          const librarian = { ...(reading !== d.reading ? { wasReading: d.reading } : {}), added }
          return { ...(change.weight ? withWeight(d, change.weight) : d), reading, related, librarian }
        }),
      )
    }, 900)
  }

  function finish(dismissAll: boolean) {
    const decide = (d: EntryDraft) => {
      const question = tracker.questionById.get(d.question_id)
      return question && outlook(tracker, d, question, d.reading).across ? decisionOf(d, d.reading!) : null
    }
    try {
      const verdict = verdictOf(drafts, reviewNote, decide, dismissAll)
      const writes = planReview(tracker, proposal, source, verdict, new Date().toISOString())
      const published = verdict.entries.filter((e) => e.publish).length
      const title = `“${sourceLabel(source)}”`
      setError(null)
      onFinish({
        writes,
        how: published ? 'publishing' : 'dismissing',
        message: `${published ? `Published ${published} ${published === 1 ? 'person' : 'people'} from ${title}.` : `Dismissed ${title}.`}${behind ? ' Here is the next card.' : ''}`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mt-7 grid grid-cols-[minmax(0,1fr)] items-start gap-9 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ReviewCard
        proposal={proposal}
        source={source}
        notes={notes}
        contexts={contexts}
        mentions={mentions}
        drafts={drafts}
        setDrafts={setDrafts}
        reviewNote={reviewNote}
        setReviewNote={setReviewNote}
        behind={behind}
        readOnly={readOnly}
        leaving={leaving}
        changingKey={changingKey}
        error={error}
        onPublish={() => finish(false)}
        onDismissAll={() => finish(true)}
      />
      <aside className="flex flex-col gap-2.5 lg:sticky lg:top-4 lg:min-h-[min(640px,calc(100dvh-2rem))]">
        {children}
        {!readOnly && rootQuestion && <Librarian question={rootQuestion} card={librarianCard} onChanges={applyChanges} />}
      </aside>
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
      <button type="button" className="btn btn-sm" onClick={run} disabled={state === 'running'} title="Searches the news for questions marked as in the news">
        {state === 'running' ? 'Searching…' : 'Search the news now'}
      </button>
    </>
  )
}

// Runs the article reader on one page without queueing anything, to see what
// the model makes of it.
function ReadArticleTrial() {
  const { tracker } = useTracker()
  const [result, setResult] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const questions = [...tracker.questionById.values()].filter((q) => !q.parent_id).sort((a, b) => a.short_title.localeCompare(b.short_title))

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setRunning(true)
    try {
      const res = await editorFetch('/api/editor/read-article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: f.get('trial_url'), question_id: f.get('trial_question') }),
      })
      setResult(JSON.stringify(await res.json(), null, 2))
    } catch (err) {
      setResult(String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-bold">Try the article reader on one page</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-muted">Fetches the page and has the model read it for everyone on the question’s roster it names. Shows what would be queued; queues nothing.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="trial_url">
              Article URL
            </label>
            <input id="trial_url" name="trial_url" type="url" required className="field" />
          </div>
          <div>
            <label className="label" htmlFor="trial_question">
              Question
            </label>
            <select id="trial_question" name="trial_question" className="field">
              {questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.short_title}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-sm" disabled={running}>
            {running ? 'Reading…' : 'Read it'}
          </button>
        </div>
        {result && <pre className="max-h-96 overflow-auto rounded-[14px] border-2 border-line bg-paper p-3 text-xs whitespace-pre-wrap">{result}</pre>}
      </form>
    </details>
  )
}
