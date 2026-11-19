import {
  stanceId,
  type Act,
  type ActKind,
  type Bearing,
  type Position,
  type Proposal,
  type ProposalItem,
  type ProposalNote,
  type Question,
  type Reading,
  type Report,
  type Source,
  type Stance,
} from '../../shared/schema.ts'

type Rows = {
  sources: Source
  acts: Act
  reports: Report
  readings: Reading
  stances: Stance
  proposals: Proposal
  proposal_items: ProposalItem
  proposal_notes: ProposalNote
}

export type Write = {
  [K in keyof Rows]:
    | { on: K; type: 'insert'; row: Rows[K] }
    | { on: K; type: 'update'; id: string; changes: Partial<Rows[K]> }
    | { on: K; type: 'delete'; id: string }
}[keyof Rows]

// The rows a plan reads to decide between inserting and updating.
export type Published = {
  questions: Question[]
  acts: Act[]
  reports: Report[]
  readings: Reading[]
  stances: Stance[]
}

export type ItemVerdict =
  | { item: ProposalItem; accept: false; comment: string | null }
  | {
      item: ProposalItem
      accept: true
      question_id: string
      // An act on file, or the id the new act takes. Accepted items of one
      // proposal that share it publish a single act.
      act_id: string
      kind: ActKind
      occurred_on: string
      quote: string
      reading: Position
      bearing: Bearing
      position: Position
      summary: string | null
      comment: string | null
    }

export type Verdict = {
  source_title: string | null
  review_note: string | null
  items: ItemVerdict[]
}

// The store sends a transaction as one batch per table, in the order each table
// first appears, and every batch may only point at rows an earlier one wrote.
// Plans list their writes in an order that respects that.
const APPROVAL_ORDER: (keyof Rows)[] = ['sources', 'acts', 'reports', 'readings', 'stances', 'proposal_items', 'proposal_notes', 'proposals']

// Everything publishing one reviewed proposal changes, as a list of writes for
// a single transaction. Every row it writes is stamped with the same `now`:
// the feed groups reports of one source with one timestamp into one story. Each accepted item publishes its act (unless it is on
// file), a report of it in the proposal's source, its reading on the item's
// question, and the stance the editor set. Rejected items only change status.
export function planReview(
  published: Published,
  proposal: Proposal,
  source: Source,
  verdict: Verdict,
  now: string,
  newId: () => string = () => crypto.randomUUID(),
): Write[] {
  const writes: Write[] = []
  const questionById = new Map(published.questions.map((q) => [q.id, q]))
  const actIds = new Set(published.acts.map((a) => a.id))
  const newActIds = new Set<string>()
  const reported = new Set(published.reports.map((r) => `${r.source_id} ${r.act_id}`))
  const readingByPair = new Map(published.readings.map((r) => [`${r.act_id} ${r.question_id}`, r]))
  const newReadings = new Map<string, Reading>()
  const stanceById = new Map(published.stances.map((s) => [s.id, s]))
  const newStances = new Map<string, Stance>()

  const read = (actId: string, questionId: string, position: Position, bearing: Bearing, via: string | null) => {
    const key = `${actId} ${questionId}`
    const mine = newReadings.get(key)
    const existing = mine ?? readingByPair.get(key)
    if (!existing) {
      const row: Reading = { id: newId(), act_id: actId, question_id: questionId, position, bearing, via_question_id: via, created_at: now }
      newReadings.set(key, row)
      writes.push({ on: 'readings', type: 'insert', row })
    } else if (via) {
      // A reading implied by a sub-question never replaces one already there.
    } else if (mine) {
      Object.assign(mine, { position, bearing, via_question_id: null })
    } else if (existing.position !== position || existing.bearing !== bearing || existing.via_question_id) {
      // Read directly, it stops being a reading the sub-question implied.
      writes.push({ on: 'readings', type: 'update', id: existing.id, changes: { position, bearing, via_question_id: null } })
    }
  }

  const stand = (questionId: string, deciderId: string, position: Position, summary: string | null, onlyIfMissing = false) => {
    const id = stanceId(questionId, deciderId)
    const pending = newStances.get(id)
    if (pending) {
      if (!onlyIfMissing) Object.assign(pending, { position, summary })
    } else if (stanceById.has(id)) {
      if (!onlyIfMissing) writes.push({ on: 'stances', type: 'update', id, changes: { position, summary, updated_at: now } })
    } else {
      const row: Stance = { id, question_id: questionId, decider_id: deciderId, position, summary, updated_at: now }
      newStances.set(id, row)
      writes.push({ on: 'stances', type: 'insert', row })
    }
  }

  if (verdict.source_title !== source.title) writes.push({ on: 'sources', type: 'update', id: source.id, changes: { title: verdict.source_title } })

  for (const v of verdict.items) {
    if (v.comment) {
      writes.push({
        on: 'proposal_notes',
        type: 'insert',
        row: { id: newId(), proposal_id: proposal.id, proposal_item_id: v.item.id, kind: 'review', body: v.comment, created_at: now },
      })
    }
    if (!v.accept) {
      writes.push({ on: 'proposal_items', type: 'update', id: v.item.id, changes: { status: 'rejected' } })
      continue
    }
    const question = questionById.get(v.question_id)
    if (!question) throw new Error(`Unknown question ${v.question_id}`)
    const deciderId = v.item.decider_id

    const isNewAct = !actIds.has(v.act_id)
    if (isNewAct && !newActIds.has(v.act_id)) {
      newActIds.add(v.act_id)
      writes.push({
        on: 'acts',
        type: 'insert',
        row: { id: v.act_id, decider_id: deciderId, kind: v.kind, occurred_on: v.occurred_on, body: v.quote, primary_source_id: null, withdrawn_on: null, created_at: now },
      })
    }
    if (!reported.has(`${source.id} ${v.act_id}`)) {
      reported.add(`${source.id} ${v.act_id}`)
      // For an act already on file the item's words are this source's wording of it.
      writes.push({
        on: 'reports',
        type: 'insert',
        row: { id: newId(), source_id: source.id, act_id: v.act_id, excerpt: isNewAct ? null : v.quote, created_at: now },
      })
    }

    read(v.act_id, question.id, v.reading, v.bearing, null)
    stand(question.id, deciderId, v.position, v.summary)
    // Doing the thing a sub-question asks about says something on its parent
    // too, if the sub-question says what. An indirect reading is too loose to
    // carry upward.
    if (question.implies_on_parent && question.parent_id && v.reading === 'support' && v.bearing === 'direct') {
      read(v.act_id, question.parent_id, question.implies_on_parent, 'direct', question.id)
      stand(question.parent_id, deciderId, question.implies_on_parent, v.summary, true)
    }

    writes.push({
      on: 'proposal_items',
      type: 'update',
      id: v.item.id,
      changes: {
        status: 'accepted',
        question_id: v.question_id,
        act_id: v.act_id,
        kind: v.kind,
        occurred_on: v.occurred_on,
        quote: v.quote,
        reading: v.reading,
        bearing: v.bearing,
        position: v.position,
        summary: v.summary,
      },
    })
  }

  if (verdict.review_note) {
    writes.push({
      on: 'proposal_notes',
      type: 'insert',
      row: { id: newId(), proposal_id: proposal.id, proposal_item_id: null, kind: 'review', body: verdict.review_note, created_at: now },
    })
  }
  writes.push({ on: 'proposals', type: 'update', id: proposal.id, changes: { status: 'reviewed', reviewed_at: now } })

  return writes.sort((a, b) => APPROVAL_ORDER.indexOf(a.on) - APPROVAL_ORDER.indexOf(b.on))
}

// Folds one act into another when both turn out to be the same real-world
// thing. Reports and readings move to the survivor; where the survivor already
// has a report from that source or a reading on that question, its own stands
// and the duplicate is deleted. The dropped act goes last, once nothing points
// at it.
export function planMerge(published: Pick<Published, 'acts' | 'reports' | 'readings'> & { proposalItems: ProposalItem[] }, keepId: string, dropId: string): Write[] {
  const keep = published.acts.find((a) => a.id === keepId)
  const drop = published.acts.find((a) => a.id === dropId)
  if (!keep || !drop) throw new Error('Both acts have to be on file.')
  if (keep.id === drop.id) throw new Error('An act cannot be merged into itself.')
  if (keep.decider_id !== drop.decider_id) throw new Error('Acts by different people cannot be the same act.')

  const writes: Write[] = []
  const keptReports = new Map(published.reports.filter((r) => r.act_id === keepId).map((r) => [r.source_id, r]))
  for (const report of published.reports.filter((r) => r.act_id === dropId)) {
    const kept = keptReports.get(report.source_id)
    if (!kept) {
      // Keeps the words this source printed, which may not be the survivor's.
      const excerpt = report.excerpt ?? (drop.body !== keep.body ? drop.body : null)
      writes.push({ on: 'reports', type: 'update', id: report.id, changes: excerpt === report.excerpt ? { act_id: keepId } : { act_id: keepId, excerpt } })
      continue
    }
    writes.push({ on: 'reports', type: 'delete', id: report.id })
    if (!kept.excerpt && report.excerpt) writes.push({ on: 'reports', type: 'update', id: kept.id, changes: { excerpt: report.excerpt } })
  }

  const keptQuestions = new Set(published.readings.filter((r) => r.act_id === keepId).map((r) => r.question_id))
  for (const reading of published.readings.filter((r) => r.act_id === dropId)) {
    writes.push(keptQuestions.has(reading.question_id) ? { on: 'readings', type: 'delete', id: reading.id } : { on: 'readings', type: 'update', id: reading.id, changes: { act_id: keepId } })
  }

  for (const item of published.proposalItems.filter((i) => i.act_id === dropId)) {
    writes.push({ on: 'proposal_items', type: 'update', id: item.id, changes: { act_id: keepId } })
  }

  if (!keep.primary_source_id && drop.primary_source_id) writes.push({ on: 'acts', type: 'update', id: keepId, changes: { primary_source_id: drop.primary_source_id } })
  writes.push({ on: 'acts', type: 'delete', id: dropId })
  return writes
}
