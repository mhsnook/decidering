import { z } from 'zod'
import { definePartyCollection } from 'party-db'

export const POSITIONS = ['support', 'lean_support', 'mixed', 'lean_oppose', 'oppose'] as const
export const positionSchema = z.enum(POSITIONS)
export type Position = z.infer<typeof positionSchema>

export const ACT_KINDS = ['statement', 'formal_act', 'vote', 'platform', 'interview', 'social'] as const
export const actKindSchema = z.enum(ACT_KINDS)
export type ActKind = z.infer<typeof actKindSchema>

export const SOURCE_KINDS = ['article', 'press_release', 'official_record', 'transcript', 'social_post'] as const

export const bodySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  jurisdiction: z.string().nullable(),
  description: z.string().nullable(),
  is_demo: z.boolean(),
  sort: z.number(),
  // The day the body next changes over and what it is called from then on.
  next_term_on: z.string().nullable(),
  next_term_label: z.string().nullable(),
})
export type Body = z.infer<typeof bodySchema>

export const deciderSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  sort_name: z.string(),
  external_id: z.string().nullable(),
  url: z.string().nullable(),
})
export type Decider = z.infer<typeof deciderSchema>

export const seatSchema = z.object({
  id: z.string(),
  body_id: z.string(),
  chamber: z.string().nullable(),
  region: z.string().nullable(),
  label: z.string(),
  is_voting: z.boolean(),
  next_election_on: z.string().nullable(),
})
export type Seat = z.infer<typeof seatSchema>

export const roleSchema = z.object({
  id: z.string(),
  seat_id: z.string(),
  decider_id: z.string(),
  kind: z.enum(['incumbent', 'challenger']),
  contest: z.enum(['primary', 'general']).nullable(),
  affiliation: z.string().nullable(),
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
})
export type Role = z.infer<typeof roleSchema>

// Whether a dated row holds on a day. A null start is "since before we kept
// track" and a null end is "no end known". The end day itself is excluded, so
// one holder can end on the day the next starts.
export const inEffect = (row: { starts_on: string | null; ends_on: string | null }, day: string) =>
  (row.starts_on === null || row.starts_on <= day) && (row.ends_on === null || day < row.ends_on)

// A key role, such as a committee chair. It outlives its holders.
export const officeSchema = z.object({
  id: z.string(),
  // null is a role held at large: it belongs to its holder in their own right
  // and shows with them in every body they sit in.
  body_id: z.string().nullable(),
  chamber: z.string().nullable(),
  label: z.string(),
  sort: z.number(),
})
export type Office = z.infer<typeof officeSchema>

export const officeHolderSchema = z.object({
  id: z.string(),
  office_id: z.string(),
  decider_id: z.string(),
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
  source_id: z.string().nullable(),
})
export type OfficeHolder = z.infer<typeof officeHolderSchema>

// Puts a question to a body beyond the one in questions.body_id.
export const questionBodySchema = z.object({
  id: z.string(),
  question_id: z.string(),
  body_id: z.string(),
})
export type QuestionBody = z.infer<typeof questionBodySchema>

// An ask put to whoever holds an office on the day being viewed.
export const questionOfficeSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  office_id: z.string(),
})
export type QuestionOffice = z.infer<typeof questionOfficeSchema>

export const questionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  body_id: z.string(),
  parent_id: z.string().nullable(),
  // 'position' asks where someone stands; 'formal_act' asks whether they did a
  // specific recordable thing (cosponsored, signed, voted), so having no stance
  // there means "has not", not "unknown".
  kind: z.enum(['position', 'formal_act']),
  title: z.string(),
  short_title: z.string(),
  description: z.string().nullable(),
  reference_url: z.string().nullable(),
  chamber: z.string().nullable(),
  is_hot: z.boolean(),
  sort: z.number(),
  // Seats needed to carry the question. null means a simple majority.
  threshold: z.number().int().positive().nullable(),
  act_label: z.string().nullable(),
  status: z.enum(['open', 'resolved', 'lapsed']),
  closed_on: z.string().nullable(),
  closed_note: z.string().nullable(),
  // A supporting reading here also writes a supporting reading on the parent,
  // as cosponsoring a bill is support for its policy. Without it, a reading on
  // a sub-question says nothing about the parent.
  implies_parent_support: z.boolean(),
})
export type Question = z.infer<typeof questionSchema>

// A question with rows here, or in question_offices, is an ask of those people
// only. One with neither applies to every seat in its body or chamber.
export const questionDeciderSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  decider_id: z.string(),
  role_label: z.string().nullable(),
})
export type QuestionDecider = z.infer<typeof questionDeciderSchema>

export const stanceSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  decider_id: z.string(),
  position: positionSchema,
  summary: z.string().nullable(),
  updated_at: z.string(),
})
export type Stance = z.infer<typeof stanceSchema>

export const sourceSchema = z.object({
  id: z.string(),
  // null for a document that reached us without a public address
  url: z.string().nullable(),
  title: z.string().nullable(),
  publisher: z.string().nullable(),
  published_on: z.string().nullable(),
  kind: z.enum(SOURCE_KINDS).nullable(),
  archive_url: z.string().nullable(),
  stored_copy: z.string().nullable(),
  created_at: z.string(),
})
export type Source = z.infer<typeof sourceSchema>

export const actSchema = z.object({
  id: z.string(),
  decider_id: z.string(),
  kind: actKindSchema,
  occurred_on: z.string(),
  body: z.string(),
  // The record of the act itself, as opposed to a source that reports it.
  primary_source_id: z.string().nullable(),
  created_at: z.string(),
})
export type Act = z.infer<typeof actSchema>

export const reportSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  act_id: z.string(),
  excerpt: z.string().nullable(),
  created_at: z.string(),
})
export type Report = z.infer<typeof reportSchema>

export const readingSchema = z.object({
  id: z.string(),
  act_id: z.string(),
  question_id: z.string(),
  position: positionSchema,
  // Set on a reading written because a sub-question implies support on this one.
  via_question_id: z.string().nullable(),
  created_at: z.string(),
})
export type Reading = z.infer<typeof readingSchema>

export const PROPOSAL_ORIGINS = ['reader', 'news_search', 'partner', 'model'] as const

export const proposalSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  origin: z.enum(PROPOSAL_ORIGINS),
  submitted_by: z.string().nullable(),
  status: z.enum(['pending', 'reviewed']),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
})
export type Proposal = z.infer<typeof proposalSchema>

export const proposalItemSchema = z.object({
  id: z.string(),
  proposal_id: z.string(),
  sort: z.number(),
  decider_id: z.string(),
  question_id: z.string(),
  // Names an act already on file, or the id a new act will take if the item is
  // accepted, so it may match no row in `acts`. Items that share it describe
  // one act.
  act_id: z.string(),
  kind: actKindSchema,
  occurred_on: z.string().nullable(),
  quote: z.string(),
  // null on a news-search lead: a search hit names a person, not a position.
  reading: positionSchema.nullable(),
  position: positionSchema.nullable(),
  summary: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'rejected']),
})
export type ProposalItem = z.infer<typeof proposalItemSchema>

export const proposalNoteSchema = z.object({
  id: z.string(),
  proposal_id: z.string(),
  proposal_item_id: z.string().nullable(),
  kind: z.enum(['submitter', 'review']),
  body: z.string(),
  created_at: z.string(),
})
export type ProposalNote = z.infer<typeof proposalNoteSchema>

// What the public form may send: one act by one person, read on one question.
export const proposalInputSchema = z.object({
  question_id: z.string().min(1),
  decider_id: z.string().min(1),
  kind: actKindSchema,
  reading: positionSchema,
  quote: z.string().trim().min(10).max(2000),
  source_url: z.url({ protocol: /^https?$/ }).max(2000),
  source_title: z.string().trim().max(300).nullable(),
  occurred_on: z.iso.date().nullable(),
  submitter_note: z.string().trim().max(1000).nullable(),
})
export type ProposalInput = z.infer<typeof proposalInputSchema>

// What the Worker turns into a proposal. Each item is a separate act.
export type ProposalDraft = {
  source: { url: string; title: string | null }
  note: string | null
  items: Pick<ProposalItem, 'question_id' | 'decider_id' | 'kind' | 'occurred_on' | 'quote' | 'reading'>[]
}

// Two links to one page should find one source, so the part after # is dropped.
export function sourceUrl(url: string): string {
  const hash = url.indexOf('#')
  return (hash === -1 ? url : url.slice(0, hash)).trim()
}

export const commentSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  author_name: z.string(),
  body: z.string(),
  created_at: z.string(),
})
export type Comment = z.infer<typeof commentSchema>

export const commentInputSchema = z.object({
  question_id: z.string().min(1),
  decider_id: z.string().min(1),
  author_name: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(2000),
})
export type CommentInput = z.infer<typeof commentInputSchema>

// The only identity this room's `auth` hook ever verifies is an editor, so
// 'authed' here means "editor". Don't hand reader accounts a uid in this room.
const editorWrites = { read: 'public', insert: 'authed', update: 'authed', delete: 'authed' } as const

export const publicCollections = [
  definePartyCollection({ name: 'bodies', key: 'id', schema: bodySchema, access: editorWrites }),
  definePartyCollection({ name: 'deciders', key: 'id', schema: deciderSchema, access: editorWrites }),
  definePartyCollection({ name: 'seats', key: 'id', schema: seatSchema, access: editorWrites }),
  definePartyCollection({ name: 'roles', key: 'id', schema: roleSchema, access: editorWrites }),
  definePartyCollection({ name: 'questions', key: 'id', schema: questionSchema, access: editorWrites }),
  definePartyCollection({ name: 'question_deciders', key: 'id', schema: questionDeciderSchema, access: editorWrites }),
  definePartyCollection({ name: 'question_bodies', key: 'id', schema: questionBodySchema, access: editorWrites }),
  definePartyCollection({ name: 'offices', key: 'id', schema: officeSchema, access: editorWrites }),
  definePartyCollection({ name: 'office_holders', key: 'id', schema: officeHolderSchema, access: editorWrites }),
  definePartyCollection({ name: 'question_offices', key: 'id', schema: questionOfficeSchema, access: editorWrites }),
  definePartyCollection({ name: 'stances', key: 'id', schema: stanceSchema, access: editorWrites }),
  definePartyCollection({ name: 'sources', key: 'id', schema: sourceSchema, access: editorWrites }),
  definePartyCollection({ name: 'acts', key: 'id', schema: actSchema, access: editorWrites }),
  definePartyCollection({ name: 'reports', key: 'id', schema: reportSchema, access: editorWrites }),
  definePartyCollection({ name: 'readings', key: 'id', schema: readingSchema, access: editorWrites }),
  // Unreviewed proposals are public. Add no column here that only an editor
  // should read; that belongs in proposal_notes.
  definePartyCollection({ name: 'proposals', key: 'id', schema: proposalSchema, access: editorWrites }),
  definePartyCollection({ name: 'proposal_items', key: 'id', schema: proposalItemSchema, access: editorWrites }),
] as const

export const proposalNotesCollection = definePartyCollection({
  name: 'proposal_notes',
  key: 'id',
  schema: proposalNoteSchema,
  access: 'authed',
})

// Sliced by thread, so a reader loads and hears only the threads they have open.
// Readers post through the Worker, which stamps and validates the row; editors
// may delete.
export const commentsCollection = definePartyCollection({
  name: 'comments',
  key: 'id',
  schema: commentSchema,
  sliceBy: 'thread_id',
  access: { read: 'public', delete: 'authed' },
})

export const allCollections = [...publicCollections, proposalNotesCollection, commentsCollection] as const

export const stanceId = (questionId: string, deciderId: string) => `${questionId}:${deciderId}`
