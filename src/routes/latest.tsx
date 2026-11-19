import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { Bearing, Decider, Position, Proposal, Question } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { atomHref, buildFeed, buildWaiting, byDay, feedPage, type FeedEntry, type FeedFilter, type WaitingEntry } from '../lib/feed.ts'
import { useTracker, type Tracker } from '../lib/tracker.tsx'
import { KIND_LABEL, formatDate, readingLabel } from '../lib/position.ts'
import { StandingDot, Syncing } from '../components/bits.tsx'
import { ActWords, IndirectTag, SourceLinks } from '../components/RecordItem.tsx'

type FeedSearch = { question?: string; waiting?: true; before?: string }

export const Route = createFileRoute('/latest')({
  component: Latest,
  validateSearch: (s: Record<string, unknown>): FeedSearch => ({
    question: typeof s.question === 'string' && s.question ? s.question : undefined,
    waiting: s.waiting === true || undefined,
    before: typeof s.before === 'string' && s.before ? s.before : undefined,
  }),
})

// How many waiting entries to list before a reader asks for more.
const WAITING_PAGE = 20

const ORIGIN: Record<Proposal['origin'], string> = {
  reader: 'Sent in by a reader',
  news_search: 'Found by the news search',
  partner: 'Sent in by a partner',
  model: 'Read from the article by a model',
}

function Latest() {
  const search = Route.useSearch()
  const bodySlug = search.body
  const navigate = Route.useNavigate()
  const { tracker, isReady } = useTracker()
  const question = search.question ? tracker.questionBySlug.get(search.question) : undefined
  const body = bodySlug ? tracker.bodyBySlug.get(bodySlug) : undefined
  const filter: FeedFilter = { questionId: question?.id, bodyId: body?.id }
  const feed = useMemo(() => buildFeed(tracker, filter), [tracker, filter.questionId, filter.bodyId])

  if (!isReady) return <Syncing />
  if ((search.question && !question) || (bodySlug && !body)) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-muted">No {search.question && !question ? 'question' : 'body'} here.</p>
        <Link to="/latest" search={{ body: undefined }} className="link">
          See everything that is new
        </Link>
      </div>
    )
  }

  const page = feedPage(feed, search.before)
  const set = (patch: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, before: undefined, ...patch }), replace: true })
  const atom = atomHref({ question: question?.slug, body: body?.slug })

  return (
    <div className="space-y-6">
      <link rel="alternate" type="application/atom+xml" title="Sporelight: latest on the record" href={atom} />
      <header className="space-y-3">
        <h1 className="h-page">Latest</h1>
        <p className="max-w-2xl text-muted">What has been added to the record, newest first. Each entry is one thing one person said or did, with what it shows on each question it bears on.</p>
      </header>

      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className="min-w-0 sm:max-w-sm sm:flex-1">
          <label className="label" htmlFor="feed-question">
            Question
          </label>
          <select id="feed-question" className="field" value={question?.slug ?? ''} onChange={(e) => set({ question: e.target.value || undefined })}>
            <option value="">Every question</option>
            <QuestionOptions tracker={tracker} />
          </select>
        </div>
        <div className="min-w-0 sm:max-w-56 sm:flex-1">
          <label className="label" htmlFor="feed-body">
            Body
          </label>
          <select id="feed-body" className="field" value={body?.slug ?? ''} onChange={(e) => set({ body: e.target.value || undefined })}>
            <option value="">Every body</option>
            {tracker.bodiesInOrder.map((b) => (
                <option key={b.id} value={b.slug}>
                  {b.name}
                  {b.is_demo ? ' (demo)' : ''}
                </option>
              ))}
          </select>
        </div>
        <button type="button" aria-pressed={!!search.waiting} className={`btn ${search.waiting ? 'btn-primary' : ''}`} onClick={() => set({ waiting: search.waiting ? undefined : true, before: search.before })}>
          {search.waiting ? 'Hide what is waiting for review' : 'Also show what is waiting for review'}
        </button>
      </div>
      <p className="text-sm">
        <a href={atom} className="link">
          Atom feed{question || body ? ' of this selection' : ''}
        </a>
        <span className="text-muted"> · published entries only</span>
      </p>

      <div className={search.waiting ? 'grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}>
        {search.waiting && <Waiting key={`${filter.questionId}:${filter.bodyId}`} filter={filter} />}
        <section aria-labelledby="published" className="lg:row-start-1">
          <h2 id="published" className="mb-3 text-xl font-semibold">
            On the record
          </h2>
          {page.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">Nothing on the record here yet.</p>
          ) : (
            <div className="space-y-6">
              {byDay(page.entries, (e) => e.enteredAt).map((day) => (
                <section key={day.day}>
                  <h3 className="tag mb-2 text-muted">Added {formatDate(day.day)}</h3>
                  <ol className="space-y-3">
                    {day.entries.map((entry) => (
                      <FeedItem key={entry.act.id} entry={entry} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
          {(page.older || !page.isFirst) && (
            <nav className="mt-6 flex flex-wrap gap-3" aria-label="Pages">
              {!page.isFirst && (
                <Link to="." search={(prev) => ({ ...prev, before: undefined })} className="btn btn-sm">
                  Back to the newest
                </Link>
              )}
              {page.older && (
                <Link to="." search={(prev) => ({ ...prev, before: page.older })} className="btn btn-sm">
                  Older entries
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  )
}

function QuestionOptions({ tracker }: { tracker: Tracker }) {
  const childrenOf = (q: Question) => [...(tracker.measuresOf.get(q.id) ?? []), ...(tracker.asksOf.get(q.id) ?? [])]
  const option = (q: Question, depth: number): ReactNode[] => [
    <option key={q.id} value={q.slug}>
      {'\u2003'.repeat(depth)}
      {depth ? q.short_title : q.title}
    </option>,
    ...childrenOf(q).flatMap((c) => option(c, depth + 1)),
  ]
  return tracker.bodiesInOrder.map((b) => {
    const listed = tracker.questionsIn(b.id).filter((q) => q.body_id === b.id)
    return listed.length === 0 ? null : (
      <optgroup key={b.id} label={b.is_demo ? `${b.name} (demo)` : b.name}>
        {listed.flatMap((q) => option(q, 0))}
      </optgroup>
    )
  })
}

// The name, what kind of act it is, and when, above the act's words.
function EntryHead({ decider, slug, isDemo, children }: { decider: Decider; slug: string; isDemo: boolean; children: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <Link to="/q/$slug/$decider" params={{ slug, decider: decider.slug }} className="font-bold hover:underline">
        {decider.name}
      </Link>
      <span className="text-xs text-muted">{children}</span>
      {isDemo && <span className="tag text-muted">demo data</span>}
    </div>
  )
}

function ReadingRow({ decider, question, position, bearing, children }: { decider: Decider; question: Question; position: Position; bearing: Bearing; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {children}
      <Link to="/q/$slug/$decider" params={{ slug: question.slug, decider: decider.slug }} className="link font-semibold">
        {question.short_title}
      </Link>
      <span>{readingLabel(position, question)}</span>
      {bearing === 'indirect' && (
        <span className="text-xs text-muted">
          <IndirectTag />
        </span>
      )}
    </li>
  )
}

function FeedItem({ entry }: { entry: FeedEntry }) {
  const { act, decider, readings, reports, isDemo } = entry
  return (
    <li className="rounded-xl border-2 border-ink bg-surface p-4">
      <EntryHead decider={decider} slug={readings[0].question.slug} isDemo={isDemo}>
        {KIND_LABEL[act.kind]} ·{' '}
        <time dateTime={act.occurred_on} className="font-semibold text-ink">
          {formatDate(act.occurred_on)}
        </time>
        {act.withdrawn_on && ` · withdrawn ${formatDate(act.withdrawn_on)}`}
      </EntryHead>
      <ActWords kind={act.kind} words={act.body} />
      <ul className="mt-3 space-y-1 text-sm">
        {readings.map(({ reading, question, via }) => (
          <ReadingRow key={reading.id} decider={decider} question={question} position={reading.position} bearing={reading.bearing}>
            <StandingDot standing={reading.position} />
            {via && <span className="order-last text-xs text-muted">through {via.short_title}</span>}
          </ReadingRow>
        ))}
      </ul>
      <SourceLinks sources={reports.map((r) => ({ key: r.report.id, source: r.source }))} />
    </li>
  )
}

// Mounted only when a reader asks for it, so a reader who never does loads no
// proposals: these queries are what subscribe to them.
function Waiting({ filter }: { filter: FeedFilter }) {
  const { tracker } = useTracker()
  const proposals = useLiveQuery((q) => q.from({ row: db.proposals }))
  const items = useLiveQuery((q) => q.from({ row: db.proposal_items }))
  const [shown, setShown] = useState(WAITING_PAGE)
  const waiting = useMemo(() => buildWaiting(tracker, proposals.data, items.data, filter), [tracker, proposals.data, items.data, filter.questionId, filter.bodyId])

  return (
    <section aria-labelledby="waiting" className="rounded-2xl border-2 border-dashed border-ink bg-mint/40 p-4 lg:col-start-2">
      <h2 id="waiting" className="text-xl font-semibold">
        Waiting for review
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        Put forward for the record and not checked by anyone yet. An editor reads each one against its source and may change or reject it. None of these count toward
        anyone's position.
      </p>
      {!proposals.isReady || !items.isReady ? (
        <p className="animate-pulse text-sm text-muted">Loading what is waiting…</p>
      ) : waiting.length === 0 ? (
        <p className="text-sm text-muted">Nothing is waiting here.</p>
      ) : (
        <>
          <ol className="space-y-3">
            {waiting.slice(0, shown).map((entry) => (
              <WaitingItem key={entry.key} entry={entry} />
            ))}
          </ol>
          {waiting.length > shown && (
            <button type="button" className="btn btn-sm mt-4" onClick={() => setShown(shown + WAITING_PAGE)}>
              Show more ({waiting.length - shown} left)
            </button>
          )}
        </>
      )}
    </section>
  )
}

function WaitingItem({ entry }: { entry: WaitingEntry }) {
  const { tracker } = useTracker()
  const { proposal, decider, claims, isDemo } = entry
  const { kind, occurred_on, quote } = claims[0].item
  const source = tracker.sourceById.get(proposal.source_id)
  return (
    <li className="rounded-xl border-2 border-dashed border-ink bg-paper p-3.5" data-waiting>
      <p className="tag mb-2">Not checked yet · {ORIGIN[proposal.origin]}</p>
      <EntryHead decider={decider} slug={claims[0].question.slug} isDemo={isDemo}>
        {KIND_LABEL[kind]}
        {occurred_on && ` · ${formatDate(occurred_on)}`}
      </EntryHead>
      <ActWords kind={kind} words={quote} />
      <ul className="mt-3 space-y-1 text-sm">
        {claims.map(({ item, question, reading }) => (
          <ReadingRow key={item.id} decider={decider} question={question} position={reading} bearing={item.bearing}>
            <span className="text-muted">Claimed:</span>
          </ReadingRow>
        ))}
      </ul>
      {source && <SourceLinks sources={[{ key: source.id, source }]} />}
      <p className="mt-2 text-xs text-muted">Put forward {formatDate(proposal.created_at)}</p>
    </li>
  )
}
