import { useId, useRef, useState } from 'react'
import type { Source } from '../../shared/schema.ts'
import { editorFetch } from '../lib/editor.ts'
import { commit } from '../lib/review.ts'

type Answer = { outcome: string; archive_url?: string; detail?: string | null } | { error: string }

// Editors only: ask for a Wayback Machine capture of a source now, or give the
// address of a copy kept anywhere else.
export function ArchiveControls({ source }: { source: Pick<Source, 'id' | 'url' | 'archive_url'> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()

  async function archiveNow() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await editorFetch('/api/editor/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source_id: source.id }) })
      const answer = (await res.json().catch(() => ({ error: `The Worker answered ${res.status}.` }))) as Answer
      setMessage('error' in answer ? `Not archived: ${answer.error}` : answer.outcome === 'archived' ? 'Archived.' : (answer.detail ?? answer.outcome))
    } catch (err) {
      setMessage(`Not archived: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function save() {
    const value = (input.current?.value ?? '').trim()
    if (value && !/^https?:\/\/\S+$/.test(value)) {
      setMessage('An archive address starts with http:// or https://.')
      return
    }
    setMessage(null)
    commit([{ on: 'sources', type: 'update', id: source.id, changes: { archive_url: value || null } }]).then(
      () => setMessage(value ? 'Saved.' : 'Removed.'),
      (err: unknown) => setMessage(`Not saved: ${err instanceof Error ? err.message : String(err)}`),
    )
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
      {source.url && !source.archive_url && (
        <button type="button" className="btn py-1 text-xs" disabled={busy} onClick={archiveNow}>
          {busy ? 'Archiving…' : 'Archive now'}
        </button>
      )}
      {/* Not a form: this sits inside the editor's review form. */}
      <span className="flex flex-wrap items-center gap-2">
        <label htmlFor={id}>Archived copy</label>
        <input
          ref={input}
          id={id}
          inputMode="url"
          defaultValue={source.archive_url ?? ''}
          key={source.archive_url ?? ''}
          placeholder="https://web.archive.org/web/…"
          className="field w-64 max-w-full py-1 text-xs"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            save()
          }}
        />
        <button type="button" className="btn py-1 text-xs" onClick={save}>
          Save
        </button>
      </span>
      {message && <span role="status">{message}</span>}
    </div>
  )
}
