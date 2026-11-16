import { useState, type FormEvent } from 'react'
import { EVIDENCE_KINDS, POSITIONS, type Decider, type Question } from '../../shared/schema.ts'
import { KIND_LABEL, SIGNAL_LABEL } from '../lib/position.ts'

type State = { status: 'idle' | 'sending' } | { status: 'sent'; duplicate: boolean } | { status: 'error'; message: string }

export function SubmitEvidence({ question, decider, onDone }: { question: Question; decider: Decider; onDone: () => void }) {
  const [state, setState] = useState<State>({ status: 'idle' })

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const text = (name: string) => (f.get(name) as string).trim()
    setState({ status: 'sending' })
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question_id: question.id,
          decider_id: decider.id,
          kind: f.get('kind'),
          signals: f.get('signals'),
          quote: text('quote'),
          source_url: text('source_url'),
          source_title: text('source_title') || null,
          occurred_on: text('occurred_on') || null,
          submitter_note: text('submitter_note') || null,
          website: text('website'),
        }),
      })
      const body = (await res.json()) as { error?: string; duplicate?: boolean }
      if (!res.ok) return setState({ status: 'error', message: body.error ?? 'Something went wrong.' })
      form.reset()
      setState({ status: 'sent', duplicate: !!body.duplicate })
    } catch {
      setState({ status: 'error', message: 'Could not reach the server. Try again in a moment.' })
    }
  }

  if (state.status === 'sent') {
    return (
      <div className="rounded-lg border border-support/50 bg-support/10 p-4 text-sm">
        <p className="font-semibold">{state.duplicate ? 'We already have that source in the queue.' : 'Thanks. An editor will check it against the source.'}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setState({ status: 'idle' })
              onDone()
            }}
          >
            Done
          </button>
          <button type="button" className="btn" onClick={() => setState({ status: 'idle' })}>
            Send another
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="quote">
          What did {decider.name} say or do?
        </label>
        <textarea id="quote" name="quote" required minLength={10} maxLength={2000} rows={3} className="field" placeholder="Their exact words, or a plain description of the act" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="source_url">
            Link to the source
          </label>
          <input id="source_url" name="source_url" type="url" required className="field" placeholder="https://" />
        </div>
        <div>
          <label className="label" htmlFor="source_title">
            Source name <span className="font-normal normal-case">(optional)</span>
          </label>
          <input id="source_title" name="source_title" maxLength={300} className="field" placeholder="Outlet and headline" />
        </div>
        <div>
          <label className="label" htmlFor="occurred_on">
            Date it happened
          </label>
          <input id="occurred_on" name="occurred_on" type="date" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="kind">
            Kind
          </label>
          <select id="kind" name="kind" className="field">
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="signals">
            What it shows
          </label>
          <select id="signals" name="signals" className="field">
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {SIGNAL_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="submitter_note">
          Anything the editor should know? <span className="font-normal normal-case">(optional)</span>
        </label>
        <input id="submitter_note" name="submitter_note" maxLength={1000} className="field" />
      </div>
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state.status === 'error' && <p className="text-sm text-oppose">{state.message}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={state.status === 'sending'}>
          {state.status === 'sending' ? 'Sending…' : 'Send for review'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
