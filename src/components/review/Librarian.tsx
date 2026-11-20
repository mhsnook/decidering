import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { Direction, Question, Weight } from '../../../shared/schema.ts'
import { db } from '../../lib/db.ts'
import { editorFetch } from '../../lib/editor.ts'

export type LibrarianChange = { entry_key: string; reading: Direction | null; weight: Weight | null; related: { question_id: string; reading: Direction | 'none' }[] }
// The open card as the librarian is told about it.
export type LibrarianCard = {
  source_title: string | null
  entries: { key: string; name: string; words: string; passage: string | null; reading: Direction | null; weight: Weight | null; related: { question_id: string; reading: Direction }[] }[]
  related_questions: { question_id: string; title: string; kind: string }[]
}

type Message = { who: 'editor' | 'librarian'; text: string }

// The chat with the librarian: a floating button that opens a panel over the
// queue list on a wide screen, and a sheet from the bottom on a phone.
export function Librarian({ question, card, onChanges }: { question: Question; card: () => LibrarianCard; onChanges: (changes: LibrarianChange[]) => void }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const guidance = useLiveQuery((q) => q.from({ row: db.question_guidance }))
  const kept = guidance.data.filter((g) => g.question_id === question.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [messages, open])

  async function send() {
    const message = draft.trim()
    if (!message || busy) return
    const history = messages
    setMessages([...history, { who: 'editor', text: message }])
    setDraft('')
    setBusy(true)
    try {
      const res = await editorFetch('/api/editor/librarian', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question_id: question.id, message, history: history.slice(-20), card: card() }),
      })
      const body = (await res.json()) as { error?: string; reply?: string; changes?: LibrarianChange[] }
      if (!res.ok || !body.reply) throw new Error(body.error ?? 'The librarian could not answer.')
      setMessages((m) => [...m, { who: 'librarian', text: body.reply! }])
      if (body.changes?.length) onChanges(body.changes)
    } catch (err) {
      setMessages((m) => [...m, { who: 'librarian', text: err instanceof Error ? err.message : String(err) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Chat with the librarian"
        onClick={() => setOpen(true)}
        inert={open}
        className={`fixed right-4 bottom-28 z-[4] flex size-14 cursor-pointer items-center justify-center gap-2.5 rounded-full border-2 border-ink bg-terminal text-paper shadow-hard-md transition-[opacity,transform] duration-300 lg:absolute lg:right-0 lg:bottom-0 lg:size-auto lg:min-h-14 lg:pr-5 lg:pl-4 lg:shadow-hard ${open ? 'scale-90 opacity-0' : ''}`}
      >
        <svg viewBox="0 0 24 24" className="size-6 lg:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16v11H9l-5 4z" />
        </svg>
        <span className="hidden size-2.5 rounded-full bg-lean-support lg:block" />
        <span className="hidden font-extrabold lg:block">Chat with the librarian</span>
      </button>
      <div onClick={() => setOpen(false)} className={`fixed inset-0 z-[5] bg-ink/45 transition-[opacity,visibility] duration-300 lg:hidden ${open ? 'visible opacity-100' : 'invisible opacity-0'}`} />
      <div
        role="dialog"
        aria-label="The librarian"
        inert={!open}
        className={`fixed inset-x-0 bottom-0 z-[6] flex h-[64%] flex-col overflow-hidden rounded-t-[20px] border-t-2 border-ink bg-surface transition-[transform,opacity,visibility] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] lg:absolute lg:inset-0 lg:h-auto lg:origin-bottom-right lg:rounded-2xl lg:border-2 lg:shadow-hard ${
          open ? 'visible' : 'invisible translate-y-[102%] lg:translate-y-6 lg:scale-[0.97] lg:opacity-0'
        }`}
      >
        <div className="flex items-start gap-2.5 border-b-2 border-ink bg-terminal py-3 pr-3 pl-4 text-paper">
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">The librarian</p>
            <p className="mt-0.5 text-[13px]">Correct this card, or tell it how to read {question.short_title}. It keeps what you tell it for every article on the question. Only editors see this chat.</p>
          </div>
          <button type="button" aria-label="Close the chat" onClick={() => setOpen(false)} className="size-10 shrink-0 cursor-pointer rounded-full border-2 border-paper text-xl leading-none">
            ×
          </button>
        </div>
        <div ref={log} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-paper px-4 py-3.5">
          <Bubble who="librarian" text={`I read the articles for ${question.short_title}. Correct an entry here, or tell me how to read this question and I will apply it to the next articles. Nothing is published until you publish.`} />
          {kept.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-bold">What I keep for this question ({kept.length})</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {kept.map((g) => (
                  <li key={g.id} className="flex items-start gap-2 rounded-lg border-2 border-line bg-surface px-2.5 py-2">
                    <span className="min-w-0 flex-1">{g.body}</span>
                    <button type="button" className="link shrink-0 cursor-pointer text-[13px] font-semibold" onClick={() => db.question_guidance.delete(g.id)}>
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} {...m} />
          ))}
          {busy && <Bubble who="librarian" text="Reading the card…" />}
        </div>
        <form
          className="flex gap-2 border-t-2 border-ink p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <input aria-label="Message to the librarian" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Correct this card, or explain how to read the question…" className="field min-h-11 min-w-0 flex-1 text-[15px]" />
          <button className="btn btn-primary min-h-11 px-3.5 text-[15px]" disabled={busy || !draft.trim()}>
            {busy ? 'Changing…' : 'Send'}
          </button>
        </form>
      </div>
    </>
  )
}

function Bubble({ who, text }: Message) {
  const mine = who === 'editor'
  return (
    <div className={`flex max-w-[90%] flex-col gap-1 ${mine ? 'self-end' : 'self-start'}`}>
      <span className={`tag text-[11px] text-faint ${mine ? 'self-end' : ''}`}>{mine ? 'You' : 'Librarian'}</span>
      <p className={`rounded-xl border-2 border-ink px-3 py-2.5 text-[15px] leading-[1.4] ${mine ? 'bg-ink text-paper' : 'bg-surface'}`}>{text}</p>
    </div>
  )
}
