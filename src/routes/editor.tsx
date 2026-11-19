import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { ACT_KINDS, BEARINGS, POSITIONS, type ActKind, type Bearing, type Position, type Proposal, type ProposalItem, type ProposalNote } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { editorFetch, isEditor, signIn, signOut } from '../lib/editor.ts'
import { commit } from '../lib/review.ts'
import { planReview, type ItemVerdict } from '../lib/review-plan.ts'
import { useTracker } from '../lib/tracker.tsx'
import { KIND_CHOICE, KIND_LABEL, POSITION_LABEL, formatDate, hostOf, standingLabel } from '../lib/position.ts'
import { Syncing, Token } from '../components/bits.tsx'
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

const ORIGIN_LABEL: Record<Proposal['origin'], string> = {
  reader: 'Sent in by a reader',
  news_search: 'News search',
  partner: 'Sent in by a partner',
  model: 'Read by a model',
}

// What the editor is told about an item's words before checking them.
const QUOTE_LABEL: Record<Proposal['origin'], string> = {
  reader: 'Reader’s quote, not yet checked',
  news_search: 'Search excerpt, not a checked quote',
  partner: 'Partner’s quote, not yet checked',
  model: 'Found in the article text by a model; check what it shows',
}

// How many waiting proposals to list beside the open one.
const UP_NEXT = 12

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

  if (!isReady || !proposals.isReady || !allItems.isReady || !allNotes.isReady) return <Syncing />

  const total = pending.length + reviewed.length
  const tabClass = (t: typeof tab) => (tab === t ? 'font-black' : 'link cursor-pointer font-semibold')

  return (
    <div className="pb-24 sm:pb-0">
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
          <button type="button" className="btn btn-sm shadow-none" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <ReadArticleTrial />

      {!selected ? (
        <div className="card card-lg mt-10 bg-mint px-5 py-7 text-center sm:mt-12 sm:p-12">
          <h2 className="text-2xl font-black sm:text-[32px]">{tab === 'pending' ? 'The queue is empty.' : 'Nothing reviewed yet.'}</h2>
          {tab === 'pending' && <p className="mt-2 text-[15px] sm:text-[17px]">Every lead has been reviewed. The news search runs once a day.</p>}
        </div>
      ) : (
        <div className="mt-6 grid items-start gap-9 sm:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
          <Review
            key={selected.id}
            proposal={selected}
            items={itemsOf(selected.id)}
            notes={allNotes.data.filter((n) => n.proposal_id === selected.id)}
            behind={others.length}
          />
          {others.length > 0 && (
            <aside>
              <h2 className="mb-2.5 text-base font-black sm:text-lg">{tab === 'pending' ? 'Up next' : 'Reviewed'}</h2>
              <ul className="flex flex-col gap-2 sm:gap-2.5">
                {others.slice(0, UP_NEXT).map((p) => {
                  const items = itemsOf(p.id)
                  const first = items[0]
                  const names = [...new Set(items.map((i) => tracker.deciderById.get(i.decider_id)?.name ?? i.decider_id))]
                  const accepted = items.filter((i) => i.status === 'accepted').length
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="flex w-full cursor-pointer items-start gap-3 rounded-[14px] border-2 border-ink bg-surface px-3.5 py-3 text-left hover:shadow-hard-md"
                      >
                        <Token
                          standing={(first && tracker.questionById.has(first.question_id) && tracker.standingFor(tracker.questionById.get(first.question_id)!, first.decider_id)) || 'unknown'}
                          className="mt-0.5 size-[22px]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2 font-bold">
                            <span className="truncate">{names.join(', ')}</span>
                            {p.status === 'pending' ? (
                              items.length > 1 && <span className="tag shrink-0">{items.length} items</span>
                            ) : (
                              <span className="tag shrink-0">
                                {accepted === 0 ? 'rejected' : accepted === items.length ? 'published' : `${accepted} of ${items.length} published`}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 line-clamp-1 text-sm leading-snug text-muted sm:line-clamp-2">{first?.quote}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {others.length > UP_NEXT && <p className="mt-3 text-sm font-semibold text-muted">and {others.length - UP_NEXT} more</p>}
              <p className="tag mt-4 hidden text-[13px] leading-[1.8] font-medium text-faint lg:block">
                J / K move · O open source
                <br />A publish · R reject
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

const SHEET = 'card card-lg shadow-none'

function Review({ proposal, items, notes, behind }: { proposal: Proposal; items: ProposalItem[]; notes: ProposalNote[]; behind: number }) {
  const { tracker } = useTracker()
  const [error, setError] = useState<string | null>(null)
  const source = tracker.sourceById.get(proposal.source_id)
  if (!source) return <p className="text-muted">This proposal points at a source that no longer exists.</p>

  const isPending = proposal.status === 'pending'
  const submitterNotes = notes.filter((n) => n.kind === 'submitter')
  const reviewNote = notes.find((n) => n.kind === 'review' && !n.proposal_item_id)
  const several = items.length > 1

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
        position: (f.get(field('position')) as Position | '' | null) || reading,
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
    <div className="relative mr-2 sm:mr-3">
      {behind > 1 && <div className={`${SHEET} absolute inset-0 translate-x-2 translate-y-3 sm:translate-x-3 sm:translate-y-4`} />}
      {behind > 0 && <div className={`${SHEET} absolute inset-0 translate-x-1 translate-y-1.5 sm:translate-x-1.5 sm:translate-y-2`} />}
      <form onSubmit={onSubmit} className={`${SHEET} relative flex flex-col gap-4 p-[18px] sm:gap-5 sm:p-7`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[22px] leading-[1.1] font-black sm:text-[28px]">{source.title ?? hostOf(source.url)}</h2>
            {several && <p className="mt-1 text-sm text-muted sm:text-base">{items.length} items from this source</p>}
          </div>
          <span className="tag-pill">
            {ORIGIN_LABEL[proposal.origin]} · {formatDate(proposal.created_at)}
          </span>
        </div>

        <fieldset disabled={!isPending} className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <div className="rounded-[14px] border-2 border-dashed border-line bg-paper px-3.5 py-3 sm:px-[18px] sm:py-4">
            <label className="label" htmlFor="source_title">
              Source
            </label>
            <input id="source_title" name="source_title" defaultValue={source.title ?? ''} className="field" />
            {source.url && (
              <a href={source.url} target="_blank" rel="noreferrer" className="link mt-2 flex min-h-11 items-center text-sm font-semibold break-all sm:min-h-0">
                {source.url} ↗
              </a>
            )}
            {submitterNotes.filter((n) => !n.proposal_item_id).map((n) => (
              <p key={n.id} className="mt-2 text-sm">
                {proposal.origin === 'reader' ? 'Reader’s note' : 'Note'}: {n.body}
              </p>
            ))}
          </div>

          {items.map((item, i) => (
            <ItemFields
              key={item.id}
              item={item}
              number={several ? i + 1 : null}
              sameActAs={items.slice(0, i).findIndex((other) => other.act_id === item.act_id) + 1 || null}
              nextSort={Math.max(...items.map((x) => x.sort)) + 1}
              comment={notes.find((n) => n.kind === 'review' && n.proposal_item_id === item.id)?.body ?? ''}
              itemNote={submitterNotes.find((n) => n.proposal_item_id === item.id)?.body ?? null}
              origin={proposal.origin}
              isPending={isPending}
            />
          ))}

          <div>
            <label className="label" htmlFor="review_note">
              Review note <span className="font-normal text-faint">(only editors see this)</span>
            </label>
            <input id="review_note" name="review_note" defaultValue={reviewNote?.body ?? ''} placeholder="Add a note…" className="field" />
          </div>

          {isPending && (
            <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2.5 border-t-2 border-ink bg-surface px-4 pt-3 pb-5 sm:static sm:gap-3 sm:border-0 sm:p-0">
              <button id="approve" name="action" value="approve" className="btn btn-lg btn-go order-2 flex-[2] sm:order-1 sm:flex-1">
                {several ? 'Publish the accepted items' : 'Approve and publish'} <span className="hidden sm:inline">[A]</span>
              </button>
              <button id="reject" name="action" value="reject" formNoValidate className="btn btn-lg order-1 flex-1 sm:order-2">
                {several ? 'Reject all' : 'Reject'} <span className="hidden sm:inline">[R]</span>
              </button>
            </div>
          )}
          {error && <p className="text-sm font-semibold text-oppose">Not saved: {error}</p>}
        </fieldset>
      </form>
    </div>
  )
}

function ItemFields({
  item,
  number,
  sameActAs,
  nextSort,
  comment,
  itemNote,
  origin,
  isPending,
}: {
  item: ProposalItem
  number: number | null
  sameActAs: number | null
  nextSort: number
  comment: string
  itemNote: string | null
  origin: Proposal['origin']
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
  // `asked` is listed even when this person would not be offered it: a select
  // whose value matches no option submits its first one.
  const family = [
    ...new Set([
      root,
      ...(tracker.measuresOf.get(root.id) ?? []).filter((m) => !m.chamber || m.chamber === chamber),
      ...tracker.asksFor(root, decider.id).map((k) => k.ask),
      asked,
    ]),
  ]
  const onFile = [...(tracker.actsByDecider.get(decider.id) ?? [])].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
  const stance = tracker.stanceFor(question, decider.id)
  const record = tracker.recordFor(question, decider.id)
  const parent = question.implies_on_parent && question.parent_id ? tracker.questionById.get(question.parent_id) : undefined
  const isFormal = question.kind === 'formal_act'
  const standing = tracker.standingFor(question, decider.id)
  const field = (name: string) => `${item.id}:${name}`
  const other = family.find((q) => q.id !== questionId)

  function readOnAnotherQuestion() {
    if (!other) return
    db.proposal_items.insert({ ...item, id: crypto.randomUUID(), sort: nextSort, question_id: other.id, reading: null, position: null, summary: null, status: 'pending' })
  }

  return (
    <section className="flex flex-col gap-4 border-t-2 border-dashed border-line pt-4 sm:gap-5 sm:pt-5" aria-label={`Item ${number ?? 1}: ${decider.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-3.5">
          <Token standing={standing} className={`size-10 border-[3px] sm:size-[52px] ${standing !== 'unknown' ? 'shadow-hard-sm sm:shadow-hard-md' : ''}`} />
          <div>
            <h3 className="text-[22px] leading-[1.1] font-black sm:text-[28px]">
              {number && <span className="mr-2 text-faint tabular-nums">{number}.</span>}
              {decider.name}
            </h3>
            <p className="mt-1 text-sm text-muted sm:text-base">{question.title}</p>
          </div>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="size-5 accent-ink" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          {isPending ? 'Publish this item' : item.status === 'accepted' ? 'Published' : 'Rejected'}
        </label>
        <input type="hidden" name={field('accept')} value={accept ? '1' : ''} />
      </div>

      <fieldset disabled={!accept} className={`min-w-0 flex-col gap-4 sm:gap-5 ${accept ? 'flex' : 'hidden'}`}>
        <div className="grid gap-3 sm:grid-cols-2">
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

        <div className="rounded-[14px] border-2 border-dashed border-line bg-paper px-3.5 py-3 sm:px-[18px] sm:py-4">
          <label className="tag text-[10px] text-faint sm:text-xs" htmlFor={field('quote')}>
            {actChoice !== 'new' ? 'How this source words it' : QUOTE_LABEL[origin]}
          </label>
          <textarea id={field('quote')} name={field('quote')} required rows={3} defaultValue={item.quote} className="field mt-2 leading-normal sm:text-lg" />
          {itemNote && <p className="mt-2 text-sm">{itemNote}</p>}
        </div>

        {actChoice === 'new' && (
          <div className="grid gap-3 sm:grid-cols-2">
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
          </div>
        )}

        <div role="radiogroup" aria-labelledby={field('reading-label')}>
          <p className="mb-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm sm:mb-3">
            <span id={field('reading-label')} className="font-bold">
              What does this show?
            </span>
            <span className="text-[13px] font-medium text-faint sm:text-sm">
              {standing !== 'unknown' ? `Now listed as ${standingLabel(standing, question)}, from ${record.length} item${record.length === 1 ? '' : 's'}` : 'Not listed yet'}
            </span>
          </p>
          <div className="grid grid-cols-5 gap-1.5 text-center text-[11px] leading-[1.15] font-bold sm:gap-2.5 sm:text-[15px]">
            {POSITIONS.map((p) => (
              <label
                key={p}
                className={`flex min-h-[72px] cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-ink bg-surface px-0.5 pt-2.5 pb-2 transition-transform has-checked:-translate-y-[3px] has-checked:shadow-hard-md has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent sm:gap-2 sm:rounded-[14px] sm:py-3 ${PICKED[p]}`}
              >
                <input type="radio" name={field('reading')} value={p} required defaultChecked={item.reading === p} className="sr-only" />
                <Token standing={p} className="size-6 sm:size-7" />
                {standingLabel(p, question)}
              </label>
            ))}
          </div>
          {parent && question.implies_on_parent && (
            <p className="mt-2.5 text-[13px] text-faint sm:text-sm">
              If this shows a yes here, it is also recorded as “{POSITION_LABEL[question.implies_on_parent]}” on “{parent.short_title}”.
            </p>
          )}
        </div>

        <div className="sm:max-w-sm">
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

        {/* Keyed by question so the defaults follow the question picked above. */}
        <div key={question.id} className={`grid gap-3 ${isFormal ? '' : 'sm:grid-cols-[12rem_1fr]'}`}>
          <div className={isFormal ? 'hidden' : ''}>
            <label className="label" htmlFor={field('position')}>
              Listed as, after approving
            </label>
            <select id={field('position')} name={field('position')} disabled={isFormal} defaultValue={item.position ?? stance?.position ?? ''} className="field">
              <option value="">Same as this item</option>
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
            <input id={field('summary')} name={field('summary')} defaultValue={item.summary ?? stance?.summary ?? ''} placeholder="Write one line…" className="field" />
          </div>
        </div>
        {isFormal && <p className="-mt-2 text-[13px] text-faint sm:text-sm">Where they stand on this is read off the acts on file, so there is no position to set.</p>}

        {record.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-bold">Already on the record ({record.length})</summary>
            <ol className="mt-2.5 space-y-2.5">
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
            Note on this item <span className="font-normal text-faint">(only editors see this)</span>
          </label>
          <input id={field('comment')} name={field('comment')} defaultValue={comment} placeholder="Add a note…" className="field" />
        </div>
        {isPending && other && (
          <button type="button" className="btn btn-sm" onClick={readOnAnotherQuestion} title="Adds an item for the same act on another question, with its own reading">
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
