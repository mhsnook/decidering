import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import type { Question } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { isEditor } from '../lib/editor.ts'
import { formatDate } from '../lib/position.ts'
import { today, useTracker, type KeyPerson } from '../lib/tracker.tsx'
import { StandingPill } from './bits.tsx'
import { Modal } from './Modal.tsx'

const CLOSED_LABEL = { resolved: 'Resolved', lapsed: 'Lapsed' } as const

export function AskStatus({ ask }: { ask: Question }) {
  const { tracker } = useTracker()
  if (ask.status === 'open' || tracker.isOpen(ask)) return null
  return (
    <span className="rounded border border-line px-1.5 py-px text-[11px] font-medium whitespace-nowrap text-muted">
      {CLOSED_LABEL[ask.status]}
      {ask.closed_on && ` ${formatDate(ask.closed_on)}`}
    </span>
  )
}

// The people a question turns on, each with what is being asked of them.
export function KeyPeople({ people }: { people: KeyPerson[] }) {
  const { tracker } = useTracker()
  if (people.length === 0) return null
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Key people</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {people.map(({ ask, key, roleLabel, contender, seat }) => (
          <li key={key}>
            <Link
              to="/q/$slug/$decider"
              params={{ slug: ask.slug, decider: contender.decider.slug }}
              className={`block h-full rounded-lg border border-line bg-surface p-3 hover:border-ink ${tracker.isOpen(ask) ? '' : 'opacity-70'}`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="leading-snug font-medium">{contender.decider.name}</span>
                <StandingPill standing={contender.standing} question={ask} />
              </span>
              <span className="block text-xs text-muted">
                {roleLabel ?? seat.label}
                {contender.role.affiliation && ` · ${contender.role.affiliation}`}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {ask.title}
                <AskStatus ask={ask} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Editors only. An ask closes when it is met (resolved) or when it stops being
// what anyone is asking for (lapsed).
export function CloseAsk({ ask }: { ask: Question }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!isEditor()) return null

  const save = (changes: Pick<Question, 'status' | 'closed_on' | 'closed_note'>) => {
    setError(null)
    db.questions
      .update(ask.id, (q) => void Object.assign(q, changes))
      .isPersisted.promise.then(
        () => setOpen(false),
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      )
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save({ status: f.get('status') as 'resolved' | 'lapsed', closed_on: f.get('closed_on') as string, closed_note: (f.get('closed_note') as string).trim() || null })
  }

  if (ask.status !== 'open') {
    return (
      <span className="flex items-center gap-2">
        <button type="button" className="btn" onClick={() => save({ status: 'open', closed_on: null, closed_note: null })}>
          Reopen this ask
        </button>
        {error && <span className="text-sm text-oppose">Not saved: {error}</span>}
      </span>
    )
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Close this ask
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Close this ask" description={ask.title}>
        <form onSubmit={onSubmit} className="space-y-4">
          <fieldset className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name="status" value="resolved" defaultChecked className="mt-1" />
              <span>
                <span className="font-medium">Resolved.</span> What was asked has happened, or has been refused for good.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="status" value="lapsed" className="mt-1" />
              <span>
                <span className="font-medium">Lapsed.</span> This is no longer what is being asked.
              </span>
            </label>
          </fieldset>
          <div>
            <label className="label" htmlFor="closed_on">
              Date
            </label>
            <input id="closed_on" name="closed_on" type="date" required defaultValue={today()} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="closed_note">
              What happened <span className="font-normal normal-case">(shown to readers)</span>
            </label>
            <input id="closed_note" name="closed_note" maxLength={300} className="field" />
          </div>
          {error && <p className="text-sm text-oppose">Not saved: {error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary">Close the ask</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}

// A question can be known to close on a day still ahead, as a bill dies when its
// Congress ends. Until then it is open, with the date given.
export function ClosedNote({ ask }: { ask: Question }) {
  const { tracker } = useTracker()
  if (ask.status === 'open') return null
  if (tracker.isOpen(ask)) {
    return (
      <p className="rounded-lg border border-line bg-surface p-3 text-sm">
        <span className="font-semibold">Closes {ask.closed_on && formatDate(ask.closed_on)}.</span> {ask.closed_note}
      </p>
    )
  }
  return (
    <p className="rounded-lg border border-line bg-surface p-3 text-sm">
      <span className="font-semibold">
        {CLOSED_LABEL[ask.status]}
        {ask.closed_on && ` ${formatDate(ask.closed_on)}`}.
      </span>{' '}
      {ask.closed_note ?? (ask.status === 'lapsed' ? 'This is no longer being asked.' : '')}
    </p>
  )
}
