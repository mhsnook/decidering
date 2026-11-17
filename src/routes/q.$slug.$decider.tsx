import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { FOOTING_HINT } from '../../shared/standing.ts'
import { stanceId } from '../../shared/schema.ts'
import { useTracker } from '../lib/tracker.tsx'
import { FootingTag, NotFound, StandingPill, Syncing } from '../components/bits.tsx'
import { QuestionHeader } from '../components/QuestionHeader.tsx'
import { RecordItem } from '../components/RecordItem.tsx'
import { SubmitEvidence } from '../components/SubmitEvidence.tsx'
import { Discussion } from '../components/Discussion.tsx'
import { Modal } from '../components/Modal.tsx'
import { AskStatus, CloseAsk, ClosedNote } from '../components/Asks.tsx'
import { MergeAct } from '../components/MergeAct.tsx'
import { isEditor } from '../lib/editor.ts'
import { formatDate } from '../lib/position.ts'

export const Route = createFileRoute('/q/$slug/$decider')({ component: DeciderOnQuestion })

function DeciderOnQuestion() {
  const { slug, decider: deciderSlug } = Route.useParams()
  const { tracker, isReady } = useTracker()
  const [adding, setAdding] = useState(false)
  if (!isReady) return <Syncing />

  const question = tracker.questionBySlug.get(slug)
  const decider = tracker.deciderBySlug.get(deciderSlug)
  const role = decider && question && tracker.roleIn(question, decider.id)
  const seat = role && tracker.seatById.get(role.seat_id)
  const me = question && role && tracker.contender(question, role)
  if (!question || !decider || !seat || !me || !tracker.appliesTo(question, decider.id)) return <NotFound what="record" />

  const measures = (tracker.measuresOf.get(question.id) ?? []).filter((m) => !m.chamber || m.chamber === seat.chamber)
  const isAsk = tracker.isAsk(question)
  const root = (question.parent_id && tracker.questionById.get(question.parent_id)) || question
  const asks = tracker.asksFor(root, decider.id)
  const roleLabels = [...new Set(asks.map((k) => k.link.role_label).filter((l) => l !== null))]
  const rivals = (tracker.rolesBySeat.get(seat.id) ?? [])
    .filter((r) => r.decider_id !== decider.id)
    .map((r) => tracker.contender(question, r))
    .filter((c) => c !== undefined)
  const outOfScope = question.chamber && question.chamber !== seat.chamber

  return (
    <div className="space-y-8">
      <QuestionHeader question={question} deciderSlug={decider.slug} />

      <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{decider.name}</h2>
            <p className="text-sm text-muted">
              {me.role.kind === 'challenger' && `Running in the ${me.role.contest ?? ''} for `}
              {seat.label}
              {seat.chamber && `, ${seat.chamber}`}
              {me.role.affiliation && ` · ${me.role.affiliation}`}
              {seat.next_election_on && ` · next election ${formatDate(seat.next_election_on)}`}
            </p>
            {roleLabels.length > 0 && <p className="text-sm font-medium">{roleLabels.join(' · ')}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StandingPill standing={me.standing} question={question} />
            <FootingTag footing={me.footing} />
          </div>
        </div>
        {outOfScope ? (
          <p className="mt-4 text-sm text-muted">This measure is before the {question.chamber}, so it is not {decider.name}'s to sign.</p>
        ) : (
          <>
            {me.stance?.summary && <p className="mt-4 text-lg">{me.stance.summary}</p>}
            <p className="mt-2 text-sm text-muted">{FOOTING_HINT[me.footing]}</p>
          </>
        )}

        {isAsk && (
          <div className="mt-4 space-y-3">
            <ClosedNote ask={question} />
            <CloseAsk ask={question} />
          </div>
        )}

        {!isAsk && asks.length + measures.length > 0 && (
          <ul className="mt-5 divide-y divide-line border-t border-line">
            {asks.map(({ ask, contender }) => (
              <li key={ask.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <Link to="/q/$slug/$decider" params={{ slug: ask.slug, decider: decider.slug }} className="font-medium hover:underline">
                    {ask.title}
                  </Link>
                  <AskStatus ask={ask} />
                </span>
                <StandingPill standing={contender.standing} question={ask} />
              </li>
            ))}
            {measures.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <Link to="/q/$slug/$decider" params={{ slug: m.slug, decider: decider.slug }} className="hover:underline">
                  {m.title}
                </Link>
                <StandingPill standing={tracker.stanceById.get(stanceId(m.id, decider.id))?.position ?? 'unknown'} question={m} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">The record</h2>
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              Add to the record
            </button>
          </div>
          {me.record.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">
              Nothing on file. If {decider.name} has spoken about this, add it to the record.
            </p>
          ) : (
            <ol className="space-y-3">
              {me.record.map((entry) => (
                <RecordItem key={entry.reading.id} entry={entry} question={question}>
                  {isEditor() && <MergeAct act={entry.act} />}
                </RecordItem>
              ))}
            </ol>
          )}
          <Modal
            open={adding}
            onClose={() => setAdding(false)}
            title="Add to the record"
            description="An editor reads every submission against its source before it appears here."
            keepMounted
          >
            <SubmitEvidence question={question} decider={decider} onDone={() => setAdding(false)} />
          </Modal>

          <div className="mt-10">
            <Discussion question={question} decider={decider} />
          </div>
        </section>

        <aside className="space-y-6">
          {rivals.length > 0 && (
            <section>
              <h2 className="mb-2 text-base font-semibold">Also in the running for {seat.label}</h2>
              <ul className="space-y-2">
                {rivals.map((r) => (
                  <li key={r.decider.id}>
                    <Link
                      to="/q/$slug/$decider"
                      params={{ slug: question.slug, decider: r.decider.slug }}
                      className="block rounded-lg border border-line bg-surface p-3 hover:border-ink"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.decider.name}</span>
                        <StandingPill standing={r.standing} question={question} />
                      </span>
                      <span className="text-xs text-muted">
                        {r.role.kind === 'incumbent' ? 'Incumbent' : `Challenger, ${r.role.contest ?? 'undeclared'}`}
                        {r.role.affiliation && ` · ${r.role.affiliation}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {decider.url && (
            <a href={decider.url} target="_blank" rel="noreferrer" className="block text-sm text-accent underline underline-offset-2">
              Official site ↗
            </a>
          )}
          <Link to="/q/$slug" params={{ slug: question.slug }} className="block text-sm text-muted hover:text-ink">
            ← Everyone on this question
          </Link>
        </aside>
      </div>
    </div>
  )
}
