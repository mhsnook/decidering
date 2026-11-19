import { PartyDbServer, D1Adapter, getTokenFromRequest, type PersistenceAdapter } from 'party-db/server'
import {
  allCollections,
  sourceUrl,
  stanceId,
  type Comment,
  type CommentInput,
  type Proposal,
  type ProposalDraft,
  type ProposalItem,
  type ProposalNote,
  type Source,
} from '../shared/schema.ts'
import { isEditorToken } from './editor.ts'
import { alreadyProposed } from './leads.ts'

const MAX_PENDING = 500

// `queued` counts the items that were new. Zero means something already proposed from this source stood in the way of every one.
export type SubmitResult = { ok: true; queued: number } | { ok: false; status: number; error: string }

export class Tracker extends PartyDbServer<Env> {
  collections = [...allCollections]

  auth = async (req: Request) => {
    const token = getTokenFromRequest(req)
    return token && (await isEditorToken(token, this.env)) ? { claims: { sub: 'editor' } } : null
  }

  // party-db replays its change log to a reconnecting client, and sends entries
  // for a table this room no longer serves to everyone, since no access rule is
  // left to filter them. A table dropped by a migration (submissions held
  // editor-only notes) would be replayed to anonymous readers, so its entries
  // are cleared before the room takes any connection.
  async onStart() {
    await super.onStart()
    const served = this.collections.map((c) => c.name)
    await this.env.DB.prepare(`DELETE FROM _oplog WHERE channel NOT IN (${served.map(() => '?').join(', ')})`)
      .bind(...served)
      .run()
  }

  protected createAdapter(): PersistenceAdapter {
    return new D1Adapter(this.env.DB, this.collections, { oplogRetention: this.oplogRetention })
  }

  // Unreviewed proposals enter here rather than through CRUD so anonymous
  // readers never need write access to the room.
  async propose(draft: ProposalDraft, origin: Proposal['origin'], isRetry = false): Promise<SubmitResult> {
    const db = this.env.DB
    const pending = await db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'`).first<{ n: number }>()
    if ((pending?.n ?? 0) >= MAX_PENDING) {
      return { ok: false, status: 429, error: 'The review queue is full right now. Please try again later.' }
    }

    const url = sourceUrl(draft.source.url)
    const known = await db.prepare(`SELECT id FROM sources WHERE url = ?`).bind(url).first<{ id: string }>()
    let items = draft.items
    if (known) {
      const seen = await db
        .prepare(`SELECT i.question_id, i.decider_id, i.status, i.quote FROM proposal_items i JOIN proposals p ON p.id = i.proposal_id WHERE p.source_id = ?`)
        .bind(known.id)
        .all<Pick<ProposalItem, 'question_id' | 'decider_id' | 'status' | 'quote'>>()
      items = items.filter((i) => !alreadyProposed(seen.results, i, origin))
    }
    if (items.length === 0) return { ok: true, queued: 0 }

    const now = new Date().toISOString()
    const source: Source = {
      id: known?.id ?? crypto.randomUUID(),
      url,
      title: draft.source.title,
      publisher: null,
      published_on: null,
      kind: null,
      archive_url: null,
      stored_copy: null,
      created_at: now,
    }
    const proposal: Proposal = { id: crypto.randomUUID(), source_id: source.id, origin, submitted_by: null, status: 'pending', created_at: now, reviewed_at: null }
    const rows: ProposalItem[] = items.map((item, sort) => ({
      ...item,
      id: crypto.randomUUID(),
      proposal_id: proposal.id,
      sort,
      act_id: crypto.randomUUID(),
      bearing: 'direct',
      position: null,
      summary: null,
      status: 'pending',
    }))
    const note: ProposalNote | null = draft.note
      ? { id: crypto.randomUUID(), proposal_id: proposal.id, proposal_item_id: null, kind: 'submitter', body: draft.note, created_at: now }
      : null
    try {
      // In this order: each batch may only point at rows an earlier one wrote.
      await this.commit([
        ...(known ? [] : [{ channel: 'sources', ops: [{ type: 'insert' as const, value: source }] }]),
        { channel: 'proposals', ops: [{ type: 'insert', value: proposal }] },
        { channel: 'proposal_items', ops: rows.map((value) => ({ type: 'insert' as const, value })) },
        ...(note ? [{ channel: 'proposal_notes', ops: [{ type: 'insert' as const, value: note }] }] : []),
      ])
      return { ok: true, queued: rows.length }
    } catch (e) {
      const message = String(e)
      // Someone else added this URL between the lookup and the commit. The
      // second pass finds their source.
      if (message.includes('UNIQUE') && !isRetry) return this.propose(draft, origin, true)
      if (message.includes('FOREIGN KEY')) return { ok: false, status: 400, error: 'Unknown question or decider.' }
      throw e
    }
  }

  async comment(input: CommentInput): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const known = await this.env.DB.prepare(
      `SELECT 1 FROM questions q, deciders d WHERE q.id = ? AND d.id = ?`,
    )
      .bind(input.question_id, input.decider_id)
      .first()
    if (!known) return { ok: false, status: 400, error: 'Unknown question or decider.' }
    const row: Comment = {
      id: crypto.randomUUID(),
      thread_id: stanceId(input.question_id, input.decider_id),
      author_name: input.author_name,
      body: input.body,
      created_at: new Date().toISOString(),
    }
    await this.commit([{ channel: 'comments', ops: [{ type: 'insert', value: row }] }])
    return { ok: true }
  }
}
