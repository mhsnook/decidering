import { z } from 'zod'
import { definePartyCollection } from 'party-db'

export const POSITIONS = ['support', 'lean_support', 'mixed', 'lean_oppose', 'oppose'] as const
export const positionSchema = z.enum(POSITIONS)
export type Position = z.infer<typeof positionSchema>

export const EVIDENCE_KINDS = ['statement', 'formal_act', 'vote', 'platform', 'interview', 'social'] as const
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS)
export type EvidenceKind = z.infer<typeof evidenceKindSchema>

export const bodySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  jurisdiction: z.string().nullable(),
  description: z.string().nullable(),
  is_demo: z.boolean(),
  sort: z.number(),
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
})
export type Role = z.infer<typeof roleSchema>

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
})
export type Question = z.infer<typeof questionSchema>

export const stanceSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  decider_id: z.string(),
  position: positionSchema,
  summary: z.string().nullable(),
  updated_at: z.string(),
})
export type Stance = z.infer<typeof stanceSchema>

export const evidenceSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  decider_id: z.string(),
  kind: evidenceKindSchema,
  signals: positionSchema,
  quote: z.string(),
  source_url: z.string(),
  source_title: z.string().nullable(),
  occurred_on: z.string(),
  submission_id: z.string().nullable(),
  created_at: z.string(),
})
export type Evidence = z.infer<typeof evidenceSchema>

export const submissionSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  decider_id: z.string(),
  origin: z.enum(['public', 'news_search']),
  kind: evidenceKindSchema,
  // null on a news-search lead: a search hit names a person, not a position.
  signals: positionSchema.nullable(),
  quote: z.string(),
  source_url: z.string(),
  source_title: z.string().nullable(),
  occurred_on: z.string().nullable(),
  submitter_note: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  review_note: z.string().nullable(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
})
export type Submission = z.infer<typeof submissionSchema>

// What the public form may send. The server fills in the rest.
export const submissionInputSchema = z.object({
  question_id: z.string().min(1),
  decider_id: z.string().min(1),
  kind: evidenceKindSchema,
  signals: positionSchema,
  quote: z.string().trim().min(10).max(2000),
  source_url: z.url({ protocol: /^https?$/ }).max(2000),
  source_title: z.string().trim().max(300).nullable(),
  occurred_on: z.iso.date().nullable(),
  submitter_note: z.string().trim().max(1000).nullable(),
})
export type SubmissionInput = z.infer<typeof submissionInputSchema>
export type SubmissionDraft = Omit<SubmissionInput, 'signals'> & { signals: Position | null }

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
  definePartyCollection({ name: 'stances', key: 'id', schema: stanceSchema, access: editorWrites }),
  definePartyCollection({ name: 'evidence', key: 'id', schema: evidenceSchema, access: editorWrites }),
] as const

export const submissionsCollection = definePartyCollection({
  name: 'submissions',
  key: 'id',
  schema: submissionSchema,
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

export const allCollections = [...publicCollections, submissionsCollection, commentsCollection] as const

export const stanceId = (questionId: string, deciderId: string) => `${questionId}:${deciderId}`
