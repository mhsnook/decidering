import type { Act, Decider, Office, OfficeHolder, Proposal, ProposalItem, Question, QuestionDecider, Reading, Report, Role, Seat, Source, Stance } from '../../shared/schema.ts'
import { stanceId } from '../../shared/schema.ts'
import { buildTracker, type TrackerData } from './build-tracker.ts'

// Row builders for tests: each takes the fields a test cares about and fills in the rest.

export const question = (id: string, over: Partial<Question> = {}): Question => ({
  id,
  slug: id,
  body_id: 'body',
  parent_id: null,
  kind: 'position',
  title: `${id}?`,
  short_title: id,
  description: null,
  reference_url: null,
  chamber: null,
  is_hot: false,
  sort: 0,
  threshold: null,
  act_label: null,
  status: 'open',
  closed_on: null,
  closed_note: null,
  implies_on_parent: null,
  ...over,
})

export const decider = (id: string): Decider => ({ id, slug: id, name: id, sort_name: id, external_id: null, url: null })
export const seat = (id: string, over: Partial<Seat> = {}): Seat => ({ id, body_id: 'body', chamber: null, region: null, label: id, is_voting: true, next_election_on: null, ...over })
export const role = (seatId: string, deciderId: string, over: Partial<Role> = {}): Role => ({ id: `${seatId}:${deciderId}`, seat_id: seatId, decider_id: deciderId, kind: 'incumbent', contest: null, affiliation: null, starts_on: null, ends_on: null, ...over })
export const office = (id: string, over: Partial<Office> = {}): Office => ({ id, body_id: 'body', chamber: null, label: id, sort: 0, ...over })
export const holder = (officeId: string, deciderId: string, starts_on: string | null = null, ends_on: string | null = null): OfficeHolder => ({ id: `${officeId}:${deciderId}`, office_id: officeId, decider_id: deciderId, starts_on, ends_on, source_id: null })
export const link = (questionId: string, deciderId: string, role_label: string | null = null): QuestionDecider => ({ id: `${questionId}:${deciderId}`, question_id: questionId, decider_id: deciderId, role_label })
export const stance = (questionId: string, deciderId: string, position: Stance['position'], summary: string | null = null): Stance => ({ id: stanceId(questionId, deciderId), question_id: questionId, decider_id: deciderId, position, summary, updated_at: '2026-01-01T00:00:00.000Z' })
export const source = (id: string, over: Partial<Source> = {}): Source => ({ id, url: `https://example.com/${id}`, title: id, publisher: null, published_on: null, kind: null, archive_url: null, stored_copy: null, created_at: '2026-01-01T00:00:00.000Z', ...over })
export const act = (id: string, deciderId: string, over: Partial<Act> = {}): Act => ({ id, decider_id: deciderId, kind: 'says', occurred_on: '2026-01-01', body: id, primary_source_id: null, withdrawn_on: null, created_at: '2026-01-01T00:00:00.000Z', ...over })
export const report = (sourceId: string, actId: string, over: Partial<Report> = {}): Report => ({ id: `${sourceId}>${actId}`, source_id: sourceId, act_id: actId, excerpt: null, created_at: '2026-01-01T00:00:00.000Z', ...over })
export const reading = (actId: string, questionId: string, position: Reading['position'], via: string | null = null): Reading => ({ id: `${actId}@${questionId}`, act_id: actId, question_id: questionId, position, bearing: 'direct', via_question_id: via, created_at: '2026-01-01T00:00:00.000Z' })
export const proposal = (id: string, sourceId: string, over: Partial<Proposal> = {}): Proposal => ({ id, source_id: sourceId, origin: 'reader', submitted_by: null, status: 'pending', created_at: '2026-01-01T00:00:00.000Z', reviewed_at: null, ...over })
export const item = (id: string, proposalId: string, deciderId: string, questionId: string, over: Partial<ProposalItem> = {}): ProposalItem => ({
  id,
  proposal_id: proposalId,
  sort: 0,
  decider_id: deciderId,
  question_id: questionId,
  act_id: `act-of-${id}`,
  kind: 'says',
  occurred_on: null,
  quote: `words of ${id}`,
  reading: null,
  bearing: 'direct',
  position: null,
  summary: null,
  status: 'pending',
  ...over,
})

export const data = (over: Partial<TrackerData>): TrackerData => ({
  bodies: [{ id: 'body', slug: 'body', name: 'Body', jurisdiction: null, description: null, is_demo: false, sort: 0, next_term_on: null, next_term_label: null }],
  deciders: [],
  seats: [],
  roles: [],
  questions: [],
  questionBodies: [],
  questionDeciders: [],
  offices: [],
  officeHolders: [],
  questionOffices: [],
  stances: [],
  sources: [],
  acts: [],
  reports: [],
  readings: [],
  ...over,
})

export const TODAY = '2026-11-17'
export const track = (over: Partial<TrackerData>, asOf = TODAY) => buildTracker(data(over), asOf)
