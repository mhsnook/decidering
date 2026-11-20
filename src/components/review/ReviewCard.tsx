import { useEffect, useState, type ReactNode } from 'react'
import { SOURCE_KINDS, type Decider, type Proposal, type ProposalContext, type ProposalItem, type ProposalMention, type ProposalNote, type Source } from '../../../shared/schema.ts'
import { useTracker } from '../../lib/tracker.tsx'
import { addedEntry, missingFrom, outlook, type EntryDraft } from '../../lib/review-form.ts'
import { KIND_NOUN, UNREAD_TEXT, formatDate, hostOf, sourceLabel, standingLabel } from '../../lib/position.ts'
import { Token } from '../bits.tsx'
import { ArchivedCopy } from '../RecordItem.tsx'
import { ArchiveControls } from '../ArchiveControls.tsx'
import { ReviewEntry } from './ReviewEntry.tsx'

const ORIGIN_LINE: Record<Proposal['origin'], string> = {
  reader: 'Sent in by a reader',
  news_search: 'Found by the news search',
  partner: 'Sent in by a partner',
  model: 'Read by a model',
}

const SOURCE_KIND_LABEL: Record<(typeof SOURCE_KINDS)[number], string> = {
  article: 'Article',
  press_release: 'Press release',
  official_record: 'Official record',
  transcript: 'Transcript',
  social_post: 'Post',
}

// How the card on top of the stack is moving: resting, leaving after a
// publish, leaving after a dismissal, or about to rise from the stack.
export type CardPhase = 'in' | 'publishing' | 'dismissing' | 'arriving'

const PHASE: Record<CardPhase, string> = {
  in: 'opacity-100 transition-[transform,opacity] duration-500 ease-[cubic-bezier(.2,.7,.2,1)]',
  publishing: '-translate-y-10 scale-[0.98] opacity-0 transition-[transform,opacity] duration-[450ms] ease-in',
  dismissing: '-translate-x-[90px] -rotate-3 opacity-0 transition-[transform,opacity] duration-[450ms] ease-in',
  arriving: 'translate-x-2.5 translate-y-3.5 opacity-0',
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
const TAG = 'tag text-faint'
const SHEET = 'absolute inset-0 rounded-[22px] border-2 border-ink bg-surface'

export function ReviewCard({
  proposal,
  source,
  notes,
  contexts,
  mentions,
  drafts,
  setDrafts,
  reviewNote,
  setReviewNote,
  behind,
  readOnly,
  leaving,
  changingKey,
  error,
  onPublish,
  onDismissAll,
}: {
  proposal: Proposal
  source: Source
  notes: ProposalNote[]
  contexts: ProposalContext[]
  mentions: ProposalMention[]
  drafts: EntryDraft[]
  setDrafts: (update: (drafts: EntryDraft[]) => EntryDraft[]) => void
  reviewNote: string
  setReviewNote: (note: string) => void
  // How many proposals wait behind this one.
  behind: number
  readOnly: boolean
  leaving: 'publishing' | 'dismissing' | null
  // The entry the librarian is working on.
  changingKey: string | null
  error: string | null
  onPublish: () => void
  onDismissAll: () => void
}) {
  const { tracker } = useTracker()
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const phase: CardPhase = leaving ?? (arrived ? 'in' : 'arriving')

  const patch = (key: string, changes: Partial<EntryDraft>) => setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...changes } : d)))
  const first = drafts[0]
  const firstQuestion = first && tracker.questionById.get(first.question_id)
  const root = firstQuestion && ((firstQuestion.parent_id && tracker.questionById.get(firstQuestion.parent_id)) || firstQuestion)
  const sameRoot = drafts.every((d) => {
    const q = tracker.questionById.get(d.question_id)
    return q && (q.parent_id ?? q.id) === root?.id
  })
  // Everyone with a claim on a seat in a body the question is put to.
  const rosterById = new Map<string, Decider>()
  if (root) {
    for (const body of tracker.bodiesOf(root)) {
      for (const row of tracker.board(root, body.id)) {
        for (const c of [row.incumbent, ...row.alternates, ...row.upcoming]) if (c) rosterById.set(c.decider.id, c.decider)
      }
    }
  }
  const roster = [...rosterById.values()].sort((a, b) => a.sort_name.localeCompare(b.sort_name))

  const open = drafts.filter((d) => !d.dismissed)
  const dismissed = drafts.length - open.length
  const missing = open.map(missingFrom).find((m) => m !== null) ?? null
  // Entries that sit across from a position editors set. One makes this a bigger decision than a routine review.
  const acrossEntries = open.flatMap((d) => {
    const q = tracker.questionById.get(d.question_id)
    const view = q && outlook(tracker, d, q, d.reading)
    return q && view?.across ? [{ draft: d, question: q, view }] : []
  })
  const across = acrossEntries[0]
  const acrossName = across && (tracker.deciderById.get(across.draft.decider_id ?? '')?.name ?? 'this person')
  const isReported = tracker.reports.some((r) => r.source_id === source.id)
  const isLead = proposal.origin === 'news_search'
  const excerpt = isLead ? drafts[0]?.items[0]?.quote : undefined
  const proposalNotes = notes.filter((n) => n.kind === 'submitter' && !n.proposal_item_id)
  const itemNotes = (d: EntryDraft) => notes.filter((n) => n.kind === 'submitter' && n.proposal_item_id && d.items.some((i) => i.id === n.proposal_item_id)).map((n) => n.body)

  let publishLabel: ReactNode = open.length ? `Publish ${people(open.length)}` : 'Nothing left to publish'
  if (missing) publishLabel = `Publish needs ${missing}`
  else if (across && open.length === 1) {
    const { draft, question, view } = across
    const to = draft.decision.action === 'keep' ? view.across!.position : draft.decision.action === 'lift' ? (view.then?.calculated ?? 'unknown') : (draft.decision.position ?? draft.reading!)
    publishLabel = `Publish, ${draft.decision.action === 'keep' ? 'keep' : draft.decision.action === 'lift' ? 'show' : 'set'} ${standingLabel(to, question)}`
  }

  return (
    <div className="relative mr-2.5 mb-3.5">
      {behind > 1 && <div className={`${SHEET} translate-x-2.5 translate-y-3.5`} />}
      {behind > 0 && <div className={`${SHEET} translate-x-[5px] translate-y-[7px]`} />}
      <article
        aria-label={sourceLabel(source)}
        data-phase={phase}
        className={`relative rounded-[22px] border-ink bg-surface motion-reduce:transition-none ${across ? 'border-[3px] shadow-hard-lg' : 'border-2'} ${PHASE[phase]}`}
      >
        {across && (
          <div className="flex flex-col gap-2 rounded-t-[19px] bg-terminal p-5 text-paper">
            <span className="tag self-start rounded-full border-2 border-paper px-2.5 py-[3px]">Contradicts our recorded position</span>
            <h2 className="text-[26px] leading-[1.1] font-black">
              A new {KIND_NOUN[across.draft.kind]} {across.draft.kind === 'says' ? 'from' : 'by'} {acrossName} contradicts our recorded position
            </h2>
            <p className="text-[15px] leading-[1.45]">
              Check the source closely. Then decide below: keep our position, set a new one, or lift it and show the calculated result, {standingLabel(across.view.then?.calculated ?? 'unknown', across.question)}.
            </p>
          </div>
        )}
        <header className={`flex flex-col gap-2 border-b-2 border-ink bg-paper px-5 pt-4 pb-[18px] ${across ? '' : 'rounded-t-[20px]'}`}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <span className="tag rounded-full border-2 border-ink bg-surface px-2.5 py-[3px]">{isReported ? 'Source on the record' : 'New source'}</span>
            <span className="tag text-muted">
              {[source.kind ? SOURCE_KIND_LABEL[source.kind] : null, hostOf(source.url), source.published_on ? formatDate(source.published_on) : null].filter(Boolean).join(' · ')}
            </span>
          </div>
          <h2 className="text-[21px] leading-[1.2] font-extrabold tracking-[-0.01em]">
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">
                {sourceLabel(source)} ↗
              </a>
            ) : (
              sourceLabel(source)
            )}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-muted">
            {source.url && !isLead && (
              <a href={source.url} target="_blank" rel="noreferrer" className="link font-bold text-ink">
                Read the source <span className="hidden sm:inline">[O]</span>
              </a>
            )}
            <ArchivedCopy source={source} />
            <span>
              {ORIGIN_LINE[proposal.origin]} on {formatDate(proposal.created_at)}
            </span>
          </p>
          {proposalNotes.map((n) => (
            <p key={n.id} className="text-sm whitespace-pre-line">
              {proposal.origin === 'reader' ? 'Reader’s note' : 'Note'}: {n.body}
            </p>
          ))}
          {!readOnly && <ArchiveControls source={source} />}
        </header>

        <div className="px-5">
          {isLead && (
            <>
              <div className="my-[18px] flex flex-col gap-2.5 rounded-[14px] border-2 border-dashed border-ink bg-paper p-4">
                <p className="text-[19px] font-extrabold">We could not read this article.</p>
                <p className="leading-normal">
                  {proposal.unread ? `${UNREAD_TEXT[proposal.unread]}, so` : 'The article was not read, so'} nothing on this card is filled in. Open the source, then say what each person said or did.
                </p>
                {source.url && (
                  <a href={source.url} target="_blank" rel="noreferrer" className="btn btn-primary self-start">
                    Open the source ↗ <span className="hidden sm:inline">[O]</span>
                  </a>
                )}
              </div>
              {excerpt && (
                <div className="pb-4">
                  <p className={`${TAG} mb-1.5`}>Search excerpt, not checked</p>
                  <p className="leading-[1.55] text-muted">{excerpt}</p>
                </div>
              )}
            </>
          )}

          <p className={`${TAG} flex justify-between gap-2 pt-3.5 pb-3`}>
            <span>{isLead ? `${people(drafts.length)} named in the excerpt` : `${people(drafts.length)} in this source`}</span>
            {sameRoot && root && <span>{root.short_title}</span>}
          </p>
          <fieldset disabled={readOnly} className="min-w-0">
            {drafts.map((d) => (
              <ReviewEntry
                key={d.key}
                entry={d}
                onChange={(changes) => patch(d.key, changes)}
                onDismiss={(dismissed) => (d.items.length || !dismissed ? patch(d.key, { dismissed }) : setDrafts((all) => all.filter((x) => x.key !== d.key)))}
                proposal={proposal}
                source={source}
                context={contexts.find((c) => c.proposal_item_id === d.contextItemId)}
                notes={itemNotes(d)}
                roster={roster}
                changing={changingKey === d.key}
                readOnly={readOnly}
              />
            ))}
          </fieldset>

          {mentions.length > 0 && (
            <div className="border-t-2 border-dashed border-line pt-3 pb-3.5 text-sm text-muted">
              <p className="mb-1.5 font-bold text-ink">Named here, with nothing to record</p>
              {mentions.map((m) => (
                <p key={m.id} className="my-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Token standing="unknown" className="size-3" />
                  <b className="text-ink">{tracker.deciderById.get(m.decider_id)?.name ?? m.decider_id}</b>
                  <span>“{m.words}”</span>
                </p>
              ))}
            </div>
          )}

          <div className="-mx-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-y-2 border-ink bg-mint px-5 py-4">
            <p>
              <b>End of the people {isLead ? 'named' : 'in this source'}.</b>{' '}
              <span className="text-muted">
                {open.length} to publish{dismissed ? ` · ${dismissed} dismissed` : ''}
              </span>
            </p>
            {!readOnly && first && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDrafts((all) => [...all, addedEntry(all.find((d) => d.items.length) ?? all[0], tracker.deciderById.get(first.decider_id ?? '')?.name ?? 'the first person')])}
              >
                Add another person
              </button>
            )}
          </div>

          <div className="py-[18px]">
            <label className="label" htmlFor="review_note">
              Article review note <span className="font-normal text-faint">(only editors see this)</span>
            </label>
            <input id="review_note" value={reviewNote} disabled={readOnly} onChange={(e) => setReviewNote(e.target.value)} placeholder="Add a note on the whole article review…" className="field" />
            {error && <p className="mt-2 text-sm font-semibold text-oppose">Not saved: {error}</p>}
          </div>
        </div>

        {!readOnly && (
          <div className="sticky bottom-0 z-[3] flex gap-2.5 rounded-b-[20px] border-t-2 border-ink bg-surface px-5 pt-3.5 pb-[18px]">
            <button id="reject" type="button" onClick={onDismissAll} className="btn btn-lg flex-1">
              {drafts.length > 1 ? 'Dismiss all' : 'Dismiss'} <span className="hidden font-semibold text-faint sm:inline">[R]</span>
            </button>
            <button id="approve" type="button" onClick={onPublish} disabled={!!missing} className={`btn btn-lg flex-[2] ${across ? 'btn-primary' : 'btn-go'}`}>
              {publishLabel} {!missing && <span className="hidden font-semibold sm:inline">[A]</span>}
            </button>
          </div>
        )}
      </article>
    </div>
  )
}

// What a waiting proposal comes to in the list beside the open card.
export function upNextLine(source: Source | undefined, proposal: Proposal, items: ProposalItem[], isAcross: boolean): string {
  if (isAcross) return 'Contradicts our recorded position'
  if (proposal.origin === 'news_search' && items.every((i) => i.reading === null)) return 'Not read: open the source'
  return source ? sourceLabel(source) : 'A source that no longer exists'
}
