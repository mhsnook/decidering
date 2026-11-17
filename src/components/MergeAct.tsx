import { useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { Act } from '../../shared/schema.ts'
import { db } from '../lib/db.ts'
import { commit } from '../lib/review.ts'
import { planMerge } from '../lib/review-plan.ts'
import { useTracker } from '../lib/tracker.tsx'
import { KIND_LABEL, formatDate } from '../lib/position.ts'

// Editors only: says this act and another on file are the same thing, and
// folds this one into the other.
export function MergeAct({ act }: { act: Act }) {
  const { tracker } = useTracker()
  // The plan repoints proposal items, so they have to be loaded before it runs.
  const proposalItems = useLiveQuery((q) => q.from({ row: db.proposal_items }))
  const [error, setError] = useState<string | null>(null)
  const others = (tracker.actsByDecider.get(act.decider_id) ?? []).filter((a) => a.id !== act.id).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
  if (others.length === 0) return null

  function merge(keepId: string) {
    const keep = tracker.actById.get(keepId)
    if (!keep || !window.confirm(`Fold this act into the one from ${formatDate(keep.occurred_on)}? Its sources and readings move there, and this entry goes away.`)) return
    setError(null)
    try {
      commit(planMerge({ ...tracker, proposalItems: proposalItems.data }, keepId, act.id)).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
      <label htmlFor={`merge-${act.id}`}>Same act as</label>
      <select id={`merge-${act.id}`} className="field w-auto max-w-full py-1 text-xs" value="" disabled={!proposalItems.isReady} onChange={(e) => merge(e.target.value)}>
        <option value="">Choose to merge…</option>
        {others.map((a) => (
          <option key={a.id} value={a.id}>
            {formatDate(a.occurred_on)} · {KIND_LABEL[a.kind]} · {a.body.slice(0, 60)}
          </option>
        ))}
      </select>
      {error && <span className="text-oppose">Not saved: {error}</span>}
    </div>
  )
}
