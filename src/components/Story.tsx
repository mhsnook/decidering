import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import type { Bearing, Position, Proposal, Question, Source } from '../../shared/schema.ts'
import type { Story, StoryItem, WaitingStory } from '../lib/feed.ts'
import { KIND_LABEL, SPECTRUM, STANDING_COLOR, formatDate, hostOf, sourceLabel, standingLabel } from '../lib/position.ts'
import { Token } from './bits.tsx'
import { ActWords, ArchivedCopy, IndirectTag } from './RecordItem.tsx'

// Replies shown before a reader opens the rest of a story.
const FOLDED = 3
const DOTS = 24
// Claims a folded waiting story lists under its source line.
const CLAIM_LINES = 2

// Who put a proposal forward, in the few words the folded line has room for.
const FROM: Record<Proposal['origin'], string> = {
  reader: 'from a reader',
  news_search: 'from the news search',
  partner: 'from a partner',
  model: 'from a model',
}

const ORIGIN: Record<Proposal['origin'], string> = {
  reader: 'Sent in by a reader',
  news_search: 'Found by the news search',
  partner: 'Sent in by a partner',
  model: 'Read from the article by a model',
}

// "Nduka, Calloway" as "C. Nduka", for the folded summary of what is waiting.
const shortName = (d: StoryItem['decider']) => {
  const [last, first] = d.sort_name.split(', ')
  return first ? `${first[0]}. ${last}` : d.name
}

function SourceLink({ source }: { source: Pick<Source, 'title' | 'url'> }) {
  const className = 'h-card mt-0.5 block'
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" className={`${className} hover:underline`}>
      {sourceLabel(source)} ↗
    </a>
  ) : (
    <span className={className}>{sourceLabel(source)}</span>
  )
}

// A person's page on one question.
function PersonLink({ slug, decider, hash, className = 'font-bold hover:underline', children }: { slug: string; decider: StoryItem['decider']; hash?: string; className?: string; children?: ReactNode }) {
  return (
    <Link to="/q/$slug/$decider" params={{ slug, decider: decider.slug }} hash={hash} className={className}>
      {children ?? decider.name}
    </Link>
  )
}

// What one reading, published or claimed, shows on one question. `lead` goes first: a token, or "Claimed:".
function ReadingLine({ decider, position, question, via, bearing, lead }: { decider: StoryItem['decider']; position: Position; question: Question; via?: Question; bearing: Bearing; lead: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-1.5">
      {lead}
      <span className="font-semibold">{standingLabel(position, question)}</span>
      <span className="text-muted">on</span>
      <PersonLink slug={question.slug} decider={decider} className="link">
        {question.short_title}
      </PersonLink>
      {via && <span className="text-muted">through {via.short_title}</span>}
      {bearing === 'indirect' && (
        <span className="text-xs text-muted">
          <IndirectTag />
        </span>
      )}
    </li>
  )
}

// One token per person, from yes to no, so a story's split reads at a glance.
function Dots({ positions }: { positions: Position[] }) {
  const sorted = [...positions].sort((a, b) => SPECTRUM.indexOf(a) - SPECTRUM.indexOf(b))
  return (
    <span className="flex max-w-48 shrink-0 flex-wrap justify-end gap-1 pt-1" aria-hidden="true">
      {sorted.slice(0, DOTS).map((p, i) => (
        <Token key={i} standing={p} className="size-4" />
      ))}
      {sorted.length > DOTS && <span className="tag self-center text-muted">+{sorted.length - DOTS}</span>}
    </span>
  )
}

function Folded<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ol className="divide-y divide-line px-4">{(open ? items : items.slice(0, FOLDED)).map(render)}</ol>
      {items.length > FOLDED && (
        <button type="button" aria-expanded={open} className="w-full cursor-pointer border-t-2 border-dashed border-line px-4 py-2.5 text-left text-sm font-bold hover:bg-paper" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show ${items.length - FOLDED} more`}
        </button>
      )}
    </>
  )
}

export function StoryCard({ story }: { story: Story }) {
  const people = story.items.length
  return (
    <article className="card overflow-hidden" aria-label={sourceLabel(story.source)}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-ink bg-paper/60 px-4 py-3">
        <div className="min-w-0">
          <p className="tag text-muted">
            {hostOf(story.source.url)} · added {formatDate(story.at)} · {people} {people === 1 ? 'person' : 'people'}
            {story.isDemo && ' · demo data'}
          </p>
          <SourceLink source={story.source} />
          <ArchivedCopy source={story.source} />
        </div>
        {people > 1 && <Dots positions={story.items.map((i) => i.readings[0].reading.position)} />}
      </header>
      <Folded
        items={story.items}
        render={(item) => (
          <li key={item.act.id} className="flex gap-3 py-3">
            <Token standing={item.readings[0].reading.position} className="mt-0.5 size-6" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <PersonLink slug={item.readings[0].question.slug} decider={item.decider} />
                <span className="text-xs text-muted">
                  {KIND_LABEL[item.act.kind]} · <time dateTime={item.act.occurred_on}>{formatDate(item.act.occurred_on)}</time>
                  {item.act.withdrawn_on && ` · withdrawn ${formatDate(item.act.withdrawn_on)}`}
                  {!item.isNew && ' · already on the record'}
                </span>
              </p>
              <ActWords kind={item.act.kind} words={item.words} />
              <ul className="space-y-0.5 text-sm">
                {item.readings.map(({ reading, question, via }) => (
                  <ReadingLine
                    key={reading.id}
                    decider={item.decider}
                    position={reading.position}
                    question={question}
                    via={via}
                    bearing={reading.bearing}
                    lead={<Token standing={reading.position} className="size-3" />}
                  />
                ))}
              </ul>
            </div>
          </li>
        )}
      />
    </article>
  )
}

// Unchecked, so it stays one line until a reader opens it, and then asks them to check it.
export function WaitingStoryCard({ story }: { story: WaitingStory }) {
  const [open, setOpen] = useState(false)
  const claims = story.items.flatMap(({ decider, claims }) => claims.map((claim) => ({ decider, claim })))
  return (
    <article className="rounded-lg border-2 border-dashed border-line bg-paper/70 text-sm" aria-label={`Not checked yet: ${story.source ? sourceLabel(story.source) : 'a proposal'}`} data-waiting>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="block w-full cursor-pointer space-y-0.5 px-3 py-2 text-left text-xs">
        <span className="flex items-baseline gap-x-2">
          <span className="tag shrink-0 text-[11px]">Not checked yet</span>
          <span className="min-w-0 flex-1 truncate text-muted">
            {story.isDemo && 'demo · '}
            {story.source?.url && `${hostOf(story.source.url)} · `}
            {FROM[story.proposal.origin]}
          </span>
          <span className="shrink-0 font-bold">{open ? 'Hide' : 'Review'}</span>
        </span>
        <span className="block truncate text-sm font-semibold">{story.source ? sourceLabel(story.source) : 'A source with no link'}</span>
        {!open &&
          claims.slice(0, CLAIM_LINES).map(({ decider, claim }) => (
            <span key={claim.item.id} className="flex items-center gap-x-1.5 truncate">
              <span className="size-2.5 shrink-0 rounded-full border-2 border-dashed" style={{ borderColor: STANDING_COLOR[claim.reading] }} />
              <span className="font-semibold">{shortName(decider)}</span>
              <span>{standingLabel(claim.reading, claim.question).toLowerCase()}</span>
              <span className="text-muted">
                on {claim.question.short_title} · prev. {standingLabel(claim.before, claim.question).toLowerCase()}
              </span>
            </span>
          ))}
        {!open && claims.length > CLAIM_LINES && <span className="block text-muted">+{claims.length - CLAIM_LINES} more</span>}
      </button>
      {open && (
        <div className="border-t-2 border-dashed border-ink">
          <ol className="divide-y divide-line px-4">
            {story.items.map(({ key, decider, claims }) => {
              const { kind, occurred_on, quote } = claims[0].item
              return (
                <li key={key} className="space-y-1 py-3">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <PersonLink slug={claims[0].question.slug} decider={decider} />
                    <span className="text-xs text-muted">
                      {KIND_LABEL[kind]}
                      {occurred_on && ` · ${formatDate(occurred_on)}`}
                    </span>
                  </p>
                  <ActWords kind={kind} words={quote} />
                  <ul className="space-y-0.5">
                    {claims.map(({ item, question, reading }) => (
                      <ReadingLine key={item.id} decider={decider} position={reading} question={question} bearing={item.bearing} lead={<span className="text-muted">Claimed:</span>} />
                    ))}
                  </ul>
                </li>
              )
            })}
          </ol>
          <div className="space-y-2 border-t-2 border-dashed border-ink bg-mint/50 px-4 py-3">
            <p className="font-bold">Can you review this?</p>
            <p>
              {ORIGIN[story.proposal.origin]} on {formatDate(story.proposal.created_at)}. No editor has checked it yet, and it does not count toward anyone’s position until one
              does. Read the source: are these the words, and do they show what is claimed? If something is wrong or missing, say so in the discussion on that person’s page.
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {story.source?.url && (
                <a href={story.source.url} target="_blank" rel="noreferrer" className="link font-semibold">
                  Read the source ↗
                </a>
              )}
              {story.source && <ArchivedCopy source={story.source} />}
              {story.items.map(({ key, decider, claims }) => (
                <PersonLink key={key} slug={claims[0].question.slug} decider={decider} hash="discussion" className="link">
                  Discuss {decider.name}
                </PersonLink>
              ))}
            </p>
          </div>
        </div>
      )}
    </article>
  )
}
