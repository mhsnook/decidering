import type { Position, Question, ActKind, Role } from '../../shared/schema.ts'

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
  statement: 'Statement',
  formal_act: 'Formal act',
  vote: 'Vote',
  platform: 'Platform',
  interview: 'Interview',
  social: 'Social post',
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

type Claim = Pick<Role, 'starts_on' | 'ends_on' | 'certainty' | 'contest'>
const CONTEST: Record<NonNullable<Role['contest']>, string> = { primary: 'primary', general: 'general election', runoff: 'runoff', recount: 'recount' }

// Where someone's claim on a seat stands on a day, in a few words. A sitting
// member, a member-elect, the leader in a recount and a challenger are all
// claims; only the dates, the certainty and the contest differ.
export function claimLabel(role: Claim, day: string): string {
  const pending = role.contest ? `, ${CONTEST[role.contest]} pending` : ', not settled'
  if (role.ends_on !== null && role.ends_on <= day) return `held the seat until ${formatDate(role.ends_on)}`
  if (role.starts_on !== null && role.starts_on > day) {
    const from = formatDate(role.starts_on)
    if (role.certainty === 'certain') return `takes the seat ${from}`
    if (role.certainty === 'likely') return `likely to take the seat ${from}${pending}`
    return role.contest === 'primary' || role.contest === 'general' ? `running in the ${CONTEST[role.contest]}` : `may take the seat ${from}${pending}`
  }
  if (role.certainty === 'likely') return `likely holds the seat${pending}`
  if (role.certainty === 'possible') return `may hold the seat${pending}`
  return role.ends_on ? `holds the seat until ${formatDate(role.ends_on)}` : 'holds the seat'
}

// The same, as the few words that go before a name in a list under a seat.
export function claimTag(role: Claim, day: string): string {
  if (role.certainty === 'possible' && role.contest) return CONTEST[role.contest]
  const upcoming = role.starts_on !== null && role.starts_on > day
  const when = upcoming ? `from ${formatDate(role.starts_on!)}` : 'now'
  return role.certainty === 'certain' ? when : `${role.certainty === 'likely' ? 'likely' : 'possibly'} ${when}`
}
