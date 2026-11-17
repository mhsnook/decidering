import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { ACT_KINDS, BEARINGS, POSITIONS, stanceId, type ActKind, type Bearing, type Position, type Proposal, type ProposalItem, type ProposalNote } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { editorFetch, isEditor, signIn, signOut } from '../lib/editor.ts'
import { commit } from '../lib/review.ts'
import { planReview, type ItemVerdict } from '../lib/review-plan.ts'
import { useTracker } from '../lib/tracker.tsx'
import { KIND_CHOICE, KIND_LABEL, SIGNAL_LABEL, formatDate, hostOf, standingLabel } from '../lib/position.ts'
import { StandingPill, Syncing } from '../components/bits.tsx'
import { RecordItem } from '../components/RecordItem.tsx'

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

const ORIGIN_LABEL: Record<Proposal['origin'], string> = {
  reader: 'Sent in by a reader',
  news_search: 'Found by news search',
  partner: 'Sent in by a partner',
  model: 'Read by a model',
}

function Queue() {
  const { tracker, isReady } = useTracker()
  const proposals = useLiveQuery((q) => q.from({ row: db.proposals }))
  const allItems = useLiveQuery((q) => q.from({ row: db.proposal_items }))
  const allNotes = useLiveQuery((q) => q.from({ row: db.proposal_notes }))
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const itemsOf = (proposalId: string) => allItems.data.filter((i) => i.proposal_id === proposalId).sort((a, b) => a.sort - b.sort)
  const pending = proposals.data.filter((p) => p.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const reviewed = proposals.data.filter((p) => p.status !== 'pending').sort((a, b) => (b.reviewed_at ?? '').localeCompare(a.reviewed_at ?? ''))
  const list = tab === 'pending' ? pending : reviewed
  const selected = list.find((p) => p.id === selectedId) ?? list[0]
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

  if (!isReady || !proposals.isReady || !allItems.isReady || !allNotes.isReady) return <Syncing />

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
            <kbd className="kbd">a</kbd> publish
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
            {list.map((p) => {
              const items = itemsOf(p.id)
              const source = tracker.sourceById.get(p.source_id)
              const names = [...new Set(items.map((i) => tracker.deciderById.get(i.decider_id)?.name ?? i.decider_id))]
              const accepted = items.filter((i) => i.status === 'accepted').length
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded-lg border p-3 text-left ${p.id === selected?.id ? 'border-ink bg-surface' : 'border-transparent hover:bg-surface'}`}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span className="truncate">{names.join(', ')}</span>
                      {p.status === 'pending' ? (
                        items.length > 1 && <span className="shrink-0 text-xs text-muted">{items.length} items</span>
                      ) : (
                        <span className={`shrink-0 text-xs ${accepted ? 'text-support' : 'text-muted'}`}>
                          {accepted === 0 ? 'rejected' : accepted === items.length ? 'published' : `${accepted} of ${items.length} published`}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">{source?.title ?? hostOf(source?.url ?? null)}</span>
                    <span className="mt-1 line-clamp-2 text-xs">{items[0]?.quote}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected && <Review key={selected.id} proposal={selected} items={itemsOf(selected.id)} notes={allNotes.data.filter((n) => n.proposal_id === selected.id)} />}
        </div>
      )}
    </div>
  )
}

function Review({ proposal, items, notes }: { proposal: Proposal; items: ProposalItem[]; notes: ProposalNote[] }) {
  const { tracker } = useTracker()
  const [error, setError] = useState<string | null>(null)
  const source = tracker.sourceById.get(proposal.source_id)
  if (!source) return <p className="text-muted">This proposal points at a source that no longer exists.</p>

  const isPending = proposal.status === 'pending'
  const submitterNotes = notes.filter((n) => n.kind === 'submitter')
  const reviewNote = notes.find((n) => n.kind === 'review' && !n.proposal_item_id)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (name: string) => ((f.get(name) as string | null) ?? '').trim()
    const rejectAll = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value === 'reject'
    const verdicts: ItemVerdict[] = items.map((item) => {
      const field = (name: string) => `${item.id}:${name}`
      const comment = text(field('comment')) || null
      if (rejectAll || f.get(field('accept')) !== '1') return { item, accept: false, comment }
      const onFile = tracker.actById.get(text(field('act')))
      const reading = f.get(field('reading')) as Position
      return {
        item,
        accept: true,
        question_id: text(field('question')),
        act_id: onFile?.id ?? item.act_id,
        kind: onFile?.kind ?? (f.get(field('kind')) as ActKind),
        occurred_on: onFile?.occurred_on ?? text(field('occurred_on')),
        quote: text(field('quote')),
        reading,
        bearing: f.get(field('bearing')) as Bearing,
        // A formal-act question has no position to judge: it is read off the acts.
        position: (f.get(field('position')) as Position | null) ?? reading,
        summary: text(field('summary')) || null,
        comment,
      }
    })
    setError(null)
    try {
      const writes = planReview(tracker, proposal, source!, { source_title: text('source_title') || null, review_note: text('review_note') || null, items: verdicts }, new Date().toISOString())
      commit(writes).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-xl font-semibold">{source.title ?? hostOf(source.url)}</h2>
          <span className="rounded bg-paper px-2 py-1 text-xs text-muted">
            {ORIGIN_LABEL[proposal.origin]} · {formatDate(proposal.created_at)}
          </span>
        </div>
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer" className="mt-3 block text-sm break-all text-accent underline underline-offset-2">
            {source.url} ↗
          </a>
        )}
        {submitterNotes.map((n) => (
          <p key={n.id} className="mt-3 rounded bg-paper p-3 text-sm">
            Note: {n.body}
          </p>
        ))}
      </div>

      <fieldset disabled={!isPending} className="space-y-5">
        <div>
          <label className="label" htmlFor="source_title">
            Source name
          </label>
          <input id="source_title" name="source_title" defaultValue={source.title ?? ''} className="field" />
        </div>

        {items.map((item, i) => (
          <ItemFields
            key={item.id}
            item={item}
            number={items.length > 1 ? i + 1 : null}
            sameActAs={items.slice(0, i).findIndex((other) => other.act_id === item.act_id) + 1 || null}
            nextSort={Math.max(...items.map((x) => x.sort)) + 1}
            comment={notes.find((n) => n.proposal_item_id === item.id)?.body ?? ''}
            isPending={isPending}
          />
        ))}

        <div>
          <label className="label" htmlFor="review_note">
            Review note <span className="font-normal normal-case">(internal)</span>
          </label>
          <input id="review_note" name="review_note" defaultValue={reviewNote?.body ?? ''} className="field" />
        </div>

        {isPending && (
          <div className="flex gap-2">
            <button id="approve" name="action" value="approve" className="btn btn-primary">
              {items.length > 1 ? 'Publish the accepted items' : 'Approve and publish'}
            </button>
            <button id="reject" name="action" value="reject" formNoValidate className="btn">
              {items.length > 1 ? 'Reject all' : 'Reject'}
            </button>
          </div>
        )}
        {error && <p className="text-sm text-oppose">Not saved: {error}</p>}
      </fieldset>
    </form>
  )
}

function ItemFields({
  item,
  number,
  sameActAs,
  nextSort,
  comment,
  isPending,
}: {
  item: ProposalItem
  number: number | null
  sameActAs: number | null
  nextSort: number
  comment: string
  isPending: boolean
}) {
  const { tracker } = useTracker()
  const [accept, setAccept] = useState(item.status !== 'rejected')
  const [questionId, setQuestionId] = useState(item.question_id)
  const [actChoice, setActChoice] = useState(tracker.actById.has(item.act_id) ? item.act_id : 'new')

  const decider = tracker.deciderById.get(item.decider_id)
  const asked = tracker.questionById.get(item.question_id)
  const question = tracker.questionById.get(questionId)
  if (!decider || !asked || !question) return <p className="text-muted">This item points at a question or person that no longer exists.</p>

  const root = (asked.parent_id && tracker.questionById.get(asked.parent_id)) || asked
  const chamber = (() => {
    const role = tracker.roleIn(root, decider.id)
    return role && tracker.seatById.get(role.seat_id)?.chamber
  })()
  const family = [
    root,
    ...(tracker.measuresOf.get(root.id) ?? []).filter((m) => !m.chamber || m.chamber === chamber),
    ...tracker.asksFor(root, decider.id).map((k) => k.ask),
  ]
  const onFile = [...(tracker.actsByDecider.get(decider.id) ?? [])].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
  const stance = tracker.stanceById.get(stanceId(question.id, decider.id))
  const record = tracker.recordFor(question, decider.id)
  const parent = question.implies_on_parent && question.parent_id ? tracker.questionById.get(question.parent_id) : undefined
  const isFormal = question.kind === 'formal_act'
  const field = (name: string) => `${item.id}:${name}`
  const other = family.find((q) => q.id !== questionId)

  function readOnAnotherQuestion() {
    if (!other) return
    db.proposal_items.insert({ ...item, id: crypto.randomUUID(), sort: nextSort, question_id: other.id, reading: null, position: null, summary: null, status: 'pending' })
  }

  return (
    <section className="space-y-4 rounded-xl border border-line p-4" aria-label={`Item ${number ?? 1}: ${decider.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {number && <span className="mr-2 text-muted tabular-nums">{number}.</span>}
            {decider.name}
          </h3>
          {!isPending && <p className={`text-xs ${item.status === 'accepted' ? 'text-support' : 'text-muted'}`}>{item.status === 'accepted' ? 'Published' : 'Rejected'}</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          Publish this item
        </label>
        <input type="hidden" name={field('accept')} value={accept ? '1' : ''} />
      </div>

      <fieldset disabled={!accept} className={`space-y-4 ${accept ? '' : 'hidden'}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={field('question')}>
              Question
            </label>
            <select id={field('question')} name={field('question')} value={questionId} onChange={(e) => setQuestionId(e.target.value)} className="field">
              {family.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.id === root.id ? q.short_title : `${q.short_title}: ${q.title}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={field('act')}>
              The act
            </label>
            <select id={field('act')} name={field('act')} value={actChoice} onChange={(e) => setActChoice(e.target.value)} className="field">
              <option value="new">{sameActAs ? `The same new act as item ${sameActAs}` : 'A new act'}</option>
              {onFile.map((a) => (
                <option key={a.id} value={a.id}>
                  On file: {formatDate(a.occurred_on)} · {KIND_LABEL[a.kind]} · {a.body.slice(0, 60)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor={field('quote')}>
            {actChoice === 'new' ? 'Quote or act, as it will be published' : 'How this source words it'}
          </label>
          <textarea id={field('quote')} name={field('quote')} required rows={3} defaultValue={item.quote} className="field" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {actChoice === 'new' && (
            <>
              <div>
                <label className="label" htmlFor={field('occurred_on')}>
                  Date it happened
                </label>
                <input id={field('occurred_on')} name={field('occurred_on')} type="date" required defaultValue={item.occurred_on ?? ''} className="field" />
              </div>
              <div>
                <label className="label" htmlFor={field('kind')}>
                  Kind
                </label>
                <select id={field('kind')} name={field('kind')} defaultValue={item.kind} className="field">
                  {ACT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_CHOICE[k]}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="label" htmlFor={field('reading')}>
              On this question it shows
            </label>
            <select id={field('reading')} name={field('reading')} required defaultValue={item.reading ?? ''} className="field">
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

        <div className="max-w-xs">
          <label className="label" htmlFor={field('bearing')}>
            It is about
          </label>
          <select id={field('bearing')} name={field('bearing')} defaultValue={item.bearing} className="field">
            {BEARINGS.map((b) => (
              <option key={b} value={b}>
                {b === 'direct' ? 'This question itself' : 'Something else that bears on it'}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg bg-surface p-4">
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            Currently listed as <StandingPill standing={tracker.standingFor(question, decider.id)} question={question} /> on {record.length} item
            {record.length === 1 ? '' : 's'}.
          </p>
          {/* Keyed by question so the defaults follow the question picked above. */}
          <div key={question.id} className={`grid gap-4 ${isFormal ? '' : 'sm:grid-cols-[12rem_1fr]'}`}>
            <div className={isFormal ? 'hidden' : ''}>
              <label className="label" htmlFor={field('position')}>
                Position after publishing
              </label>
              <select id={field('position')} name={field('position')} required disabled={isFormal} defaultValue={item.position ?? stance?.position ?? item.reading ?? ''} className="field">
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
              <label className="label" htmlFor={field('summary')}>
                One-line summary
              </label>
              <input id={field('summary')} name={field('summary')} defaultValue={item.summary ?? stance?.summary ?? ''} className="field" />
            </div>
          </div>
          {isFormal && <p className="mt-3 text-xs text-muted">Where they stand on this is read off the acts on file, so there is no position to set.</p>}
          {parent && question.implies_on_parent && (
            <p className="mt-3 text-xs text-muted">
              If this shows support here, it is also recorded as “{SIGNAL_LABEL[question.implies_on_parent]}” on “{parent.short_title}”.
            </p>
          )}
        </div>

        {record.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-muted">Already on the record ({record.length})</summary>
            <ol className="mt-2 space-y-2">
              {record.map((entry) => (
                <RecordItem key={entry.reading.id} entry={entry} question={question} />
              ))}
            </ol>
          </details>
        )}
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor={field('comment')}>
            Note on this item <span className="font-normal normal-case">(internal)</span>
          </label>
          <input id={field('comment')} name={field('comment')} defaultValue={comment} className="field" />
        </div>
        {isPending && other && (
          <button type="button" className="btn" onClick={readOnAnotherQuestion} title="Adds an item for the same act on another question, with its own reading">
            Read this act on another question too
          </button>
        )}
      </div>
    </section>
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
