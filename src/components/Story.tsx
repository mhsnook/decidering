import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import type { Position, Proposal, Source } from '../../shared/schema.ts'
import type { Story, StoryItem, StoryReading, WaitingStory } from '../lib/feed.ts'
import { KIND_LABEL, STANDING_COLOR, formatDate, hostOf, readingLabel } from '../lib/position.ts'
import { Token } from './bits.tsx'
import { ActWords, IndirectTag } from './RecordItem.tsx'

// Replies shown before a reader opens the rest of a story.
const FOLDED = 3
const DOTS = 24

const ORIGIN: Record<Proposal['origin'], string> = {
  reader: 'Sent in by a reader',
  news_search: 'Found by the news search',
  partner: 'Sent in by a partner',
  model: 'Read from the article by a model',
}

const SPECTRUM: Position[] = ['support', 'lean_support', 'mixed', 'lean_oppose', 'oppose']

const sourceTitle = (source: Pick<Source, 'title' | 'url'>) => source.title ?? hostOf(source.url)

function SourceLink({ source }: { source: Pick<Source, 'title' | 'url'> }) {
  const className = 'h-card mt-0.5 block'
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" className={`${className} hover:underline`}>
      {sourceTitle(source)} ↗
    </a>
  ) : (
    <span className={className}>{sourceTitle(source)}</span>
  )
}

function PersonLink({ slug, decider }: { slug: string; decider: StoryItem['decider'] }) {
  return (
    <Link to="/q/$slug/$decider" params={{ slug, decider: decider.slug }} className="font-bold hover:underline">
      {decider.name}
    </Link>
  )
}

function ReadingLine({ decider, reading, question, via }: StoryReading & { decider: StoryItem['decider'] }) {
  return (
    <li className="flex flex-wrap items-center gap-x-1.5">
      <Token standing={reading.position} className="size-3" />
      <span className="font-semibold">{readingLabel(reading.position, question)}</span>
      <span className="text-muted">on</span>
      <Link to="/q/$slug/$decider" params={{ slug: question.slug, decider: decider.slug }} className="link">
        {question.short_title}
      </Link>
      {via && <span className="text-muted">through {via.short_title}</span>}
      {reading.bearing === 'indirect' && (
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
    <article className="card overflow-hidden" aria-label={sourceTitle(story.source)}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-ink bg-paper/60 px-4 py-3">
        <div className="min-w-0">
          <p className="tag text-muted">
            {hostOf(story.source.url)} · added {formatDate(story.at)} · {people} {people === 1 ? 'person' : 'people'}
            {story.isDemo && ' · demo data'}
          </p>
          <SourceLink source={story.source} />
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
                {item.readings.map((r) => (
                  <ReadingLine key={r.reading.id} decider={item.decider} {...r} />
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
  const names = [...new Set(story.items.map((i) => i.decider.name))]
  return (
    <article className="rounded-xl border-2 border-dashed border-ink bg-paper/70 text-sm" aria-label={`Not checked yet: ${story.source ? sourceTitle(story.source) : 'a proposal'}`} data-waiting>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left">
        <span className="tag">Not checked yet</span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{names.join(', ')}</span>
          <span className="text-muted">
            {' '}
            in {story.source ? sourceTitle(story.source) : 'a source'} · {ORIGIN[story.proposal.origin].toLowerCase()}
            {story.isDemo && ' · demo data'}
          </span>
        </span>
        <span className="flex gap-1" aria-hidden="true">
          {story.items.flatMap((i) => i.claims).map((c) => (
            <span key={c.item.id} className="size-3.5 rounded-full border-2 border-dashed bg-surface" style={{ borderColor: STANDING_COLOR[c.reading] }} />
          ))}
        </span>
        <span className="font-bold">{open ? 'Hide' : 'Show'}</span>
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
                      <li key={item.id} className="flex flex-wrap items-center gap-x-1.5">
                        <span className="text-muted">Claimed:</span>
                        <span className="font-semibold">{readingLabel(reading, question)}</span>
                        <span className="text-muted">on</span>
                        <Link to="/q/$slug/$decider" params={{ slug: question.slug, decider: decider.slug }} className="link">
                          {question.short_title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ol>
          <div className="space-y-2 border-t-2 border-dashed border-ink bg-mint/50 px-4 py-3">
            <p className="font-bold">Can you review this?</p>
            <p>
              {ORIGIN[story.proposal.origin]} on {formatDate(story.proposal.created_at)}, and no editor has checked it yet. Read the source: are these the words, and do they show
              what is claimed? If something is wrong or missing, say so in the discussion on that person’s page, where editors read it.
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {story.source?.url && (
                <a href={story.source.url} target="_blank" rel="noreferrer" className="link font-semibold">
                  Read the source ↗
                </a>
              )}
              {story.items.map(({ key, decider, claims }) => (
                <Link key={key} to="/q/$slug/$decider" params={{ slug: claims[0].question.slug, decider: decider.slug }} hash="discussion" className="link">
                  Discuss {decider.name}
                </Link>
              ))}
            </p>
          </div>
        </div>
      )}
    </article>
  )
}
