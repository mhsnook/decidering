import { PartyDbServer, D1Adapter, getTokenFromRequest, type PersistenceAdapter } from 'party-db/server'
import { allCollections, type Submission, type SubmissionInput } from '../shared/schema.ts'
import { isEditorToken } from './editor.ts'

const MAX_PENDING = 500

export type SubmitResult = { ok: true; duplicate: boolean } | { ok: false; status: number; error: string }

export class Tracker extends PartyDbServer<Env> {
  collections = [...allCollections]

  auth = async (req: Request) => {
    const token = getTokenFromRequest(req)
    return token && (await isEditorToken(token, this.env)) ? { claims: { sub: 'editor' } } : null
  }

  protected createAdapter(): PersistenceAdapter {
    return new D1Adapter(this.env.DB, this.collections, { oplogRetention: this.oplogRetention })
  }

  // Unreviewed evidence enters here rather than through CRUD so anonymous
  // readers never need write access to the room.
  async submit(input: SubmissionInput, origin: Submission['origin']): Promise<SubmitResult> {
    const pending = await this.env.DB.prepare(`SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'`).first<{
      n: number
    }>()
    if ((pending?.n ?? 0) >= MAX_PENDING) {
      return { ok: false, status: 429, error: 'The review queue is full right now. Please try again later.' }
    }
    const row: Submission = {
      ...input,
      id: crypto.randomUUID(),
      origin,
      status: 'pending',
      review_note: null,
      created_at: new Date().toISOString(),
      reviewed_at: null,
    }
    try {
      await this.commit([{ channel: 'submissions', ops: [{ type: 'insert', value: row }] }])
      return { ok: true, duplicate: false }
    } catch (e) {
      const message = String(e)
      if (message.includes('UNIQUE')) return { ok: true, duplicate: true }
      if (message.includes('FOREIGN KEY')) return { ok: false, status: 400, error: 'Unknown question or decider.' }
      throw e
    }
  }
}
