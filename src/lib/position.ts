import type { Position, Question, ActKind } from '../../shared/schema.ts'

export type Standing = Position | 'unknown'

export const STANDINGS: Standing[] = ['support', 'lean_support', 'mixed', 'lean_oppose', 'oppose', 'unknown']

const LABEL: Record<Position, string> = {
  support: 'Yes',
  lean_support: 'Probably yes',
  mixed: 'Mixed',
  lean_oppose: 'Probably no',
  oppose: 'No',
}

// On a formal-act question a stance records the act, so its absence is a known "no".
export function standingLabel(standing: Standing, question: Pick<Question, 'kind' | 'act_label'>): string {
  if (standing === 'unknown') return question.kind === 'formal_act' ? 'Has not' : 'No record yet'
  if (question.kind === 'formal_act' && standing === 'support') return question.act_label ?? 'Signed on'
  return LABEL[standing]
}

export const SIGNAL_LABEL: Record<Position, string> = {
  support: 'Signals support',
  lean_support: 'Leans toward',
  mixed: 'Mixed signal',
  lean_oppose: 'Leans against',
  oppose: 'Signals opposition',
}

export const STANDING_BG: Record<Standing, string> = {
  support: 'bg-support',
  lean_support: 'bg-lean-support',
  mixed: 'bg-mixed',
  lean_oppose: 'bg-lean-oppose',
  oppose: 'bg-oppose',
  unknown: 'bg-unknown',
}

export const STANDING_COLOR: Record<Standing, string> = {
  support: 'var(--color-support)',
  lean_support: 'var(--color-lean-support)',
  mixed: 'var(--color-mixed)',
  lean_oppose: 'var(--color-lean-oppose)',
  oppose: 'var(--color-oppose)',
  unknown: 'var(--color-unknown)',
}

// Left to right across a chamber: the yes side, the undecided middle, the no side.
export const SPECTRUM: Standing[] = ['support', 'lean_support', 'mixed', 'unknown', 'lean_oppose', 'oppose']

export const KIND_LABEL: Record<ActKind, string> = {
  says: 'Statement',
  commits: 'Commitment',
  does: 'Action',
}

// For the forms, where someone has to pick one.
export const KIND_CHOICE: Record<ActKind, string> = {
  says: 'Said it (a statement, interview or post)',
  commits: 'Committed to it (cosponsored, signed, pledged)',
  does: 'Did it (voted, scheduled, ratified)',
}

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
export const formatDate = (iso: string) => dateFmt.format(new Date(iso))

export function hostOf(url: string | null): string {
  try {
    return url ? new URL(url).hostname : 'No link'
  } catch {
    return url ?? 'No link'
  }
}
