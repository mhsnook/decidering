import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from '@tanstack/react-router'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { pairId, type Decider, type Question } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { isEditor } from '../lib/editor.ts'
import { saveUsername, savedUsername } from '../lib/username.ts'
import { Modal } from './Modal.tsx'

const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function Discussion({ question, decider }: { question: Question; decider: Decider }) {
  const threadId = pairId(question.id, decider.id)
  const hash = useLocation({ select: (l) => l.hash })
  const section = useRef<HTMLElement>(null)
  // The router scrolls to a hash before this page has synced and rendered the section.
  useEffect(() => {
    if (hash === 'discussion') section.current?.scrollIntoView()
  }, [hash])
  // The `where` is the subscription: only this thread is loaded and listened to.
  const { data, isReady } = useLiveQuery(
    (q) =>
      q
        .from({ c: db.comments })
        .where(({ c }) => eq(c.thread_id, threadId))
        .orderBy(({ c }) => c.created_at, 'asc'),
    [threadId],
  )
  const formRef = useRef<HTMLFormElement>(null)
  const [username, setUsername] = useState(savedUsername)
  // 'post' means a comment is waiting on the name: save it, then send.
  const [asking, setAsking] = useState<'post' | 'rename' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function post(author_name: string) {
    const form = formRef.current!
    const body = form.elements.namedItem('body') as HTMLTextAreaElement
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
          body: body.value.trim(),
          website: (form.elements.namedItem('website') as HTMLInputElement).value,
        }),
      })
      if (!res.ok) return setError(((await res.json()) as { error?: string }).error ?? 'Something went wrong.')
      body.value = ''
    } catch {
      setError('Could not reach the server. Try again in a moment.')
    } finally {
      setSending(false)
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (username) post(username)
    else setAsking('post')
  }

  function onUsername(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = (new FormData(e.currentTarget).get('username') as string).trim()
    if (!name) return
    saveUsername(name)
    setUsername(name)
    if (asking === 'post') post(name)
    setAsking(null)
  }

  return (
    <section id="discussion" ref={section} className="scroll-mt-6">
      <h2 className="mb-1 text-xl font-semibold">Discussion</h2>
      <p className="mb-4 text-sm text-muted">
        Talk about {decider.name} and this question. To add something to the record itself, use “Add to the record” so an editor can check it.
      </p>

      {isReady && data.length === 0 && <p className="mb-4 rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">No comments yet.</p>}
      <ol className="mb-5 space-y-3">
        {data.map((c) => (
          <li key={c.id} className="rounded-xl border-2 border-ink bg-surface p-3">
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

      <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
        <textarea name="body" required maxLength={2000} rows={3} className="field" aria-label="Comment" placeholder="Add a comment" />
        <div className="hidden" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {error && <p className="text-sm text-oppose">{error}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="submit" className="btn" disabled={sending}>
            {sending ? 'Posting…' : 'Post comment'}
          </button>
          <p className="text-xs text-muted">
            {username ? (
              <>
                Posting as <span className="font-semibold text-ink">{username}</span> ·{' '}
                <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setAsking('rename')}>
                  change
                </button>
              </>
            ) : (
              'You’ll pick a username when you post.'
            )}
          </p>
        </div>
      </form>

      <Modal
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking === 'rename' ? 'Change your username' : 'Set a username to post'}
        description="It shows next to your comments. This browser remembers it, and you can change it any time."
      >
        <form onSubmit={onUsername} className="space-y-4">
          <div>
            <label className="label" htmlFor="username">
              Username
            </label>
            <input id="username" name="username" required maxLength={60} defaultValue={username} autoComplete="nickname" className="field" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              {asking === 'rename' ? 'Save' : 'Save and post'}
            </button>
            <button type="button" className="btn" onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </section>
  )
}
