import { useState, type FormEvent } from 'react'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { stanceId, type Decider, type Question } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { isEditor } from '../lib/editor.ts'

const NAME_KEY = 'decidering.comment-name'
const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function Discussion({ question, decider }: { question: Question; decider: Decider }) {
  const threadId = stanceId(question.id, decider.id)
  // The `where` is the subscription: only this thread is loaded and listened to.
  const { data, isReady } = useLiveQuery(
    (q) =>
      q
        .from({ c: db.comments })
        .where(({ c }) => eq(c.thread_id, threadId))
        .orderBy(({ c }) => c.created_at, 'asc'),
    [threadId],
  )
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const author_name = (f.get('author_name') as string).trim()
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question_id: question.id,
          decider_id: decider.id,
          author_name,
          body: (f.get('body') as string).trim(),
          website: f.get('website'),
        }),
      })
      if (!res.ok) return setError(((await res.json()) as { error?: string }).error ?? 'Something went wrong.')
      try {
        localStorage.setItem(NAME_KEY, author_name)
      } catch {}
      ;(form.elements.namedItem('body') as HTMLTextAreaElement).value = ''
    } catch {
      setError('Could not reach the server. Try again in a moment.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-xl font-semibold">Discussion</h2>
      <p className="mb-4 text-sm text-muted">
        Talk about {decider.name} and this question. To add something to the record itself, use the form above so an editor can check it.
      </p>

      {isReady && data.length === 0 && <p className="mb-4 rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">No comments yet.</p>}
      <ol className="mb-5 space-y-3">
        {data.map((c) => (
          <li key={c.id} className="rounded-lg border border-line bg-surface p-3">
            <p className="mb-1 flex items-baseline gap-2 text-xs text-muted">
              <span className="text-sm font-semibold text-ink">{c.author_name}</span>
              <time dateTime={c.created_at}>{timeFmt.format(new Date(c.created_at))}</time>
              {isEditor() && (
                <button type="button" className="ml-auto underline underline-offset-2 hover:text-oppose" onClick={() => db.comments.delete(c.id)}>
                  Remove
                </button>
              )}
            </p>
            <p className="text-sm whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ol>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="max-w-xs">
          <label className="label" htmlFor="author_name">
            Your name
          </label>
          <input id="author_name" name="author_name" required maxLength={60} defaultValue={savedName()} autoComplete="nickname" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="comment_body">
            Comment
          </label>
          <textarea id="comment_body" name="body" required maxLength={2000} rows={3} className="field" />
        </div>
        <div className="hidden" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {error && <p className="text-sm text-oppose">{error}</p>}
        <button type="submit" className="btn" disabled={sending}>
          {sending ? 'Posting…' : 'Post comment'}
        </button>
      </form>
    </section>
  )
}
