import type { ReactNode } from 'react'
import type { Act, Question, Source } from '../../shared/schema.ts'
import { ArchiveControls } from './ArchiveControls.tsx'
import type { RecordEntry } from '../lib/tracker.tsx'
import { KIND_LABEL, POSITION_LABEL, STANDING_BG, formatDate, sourceLabel } from '../lib/position.ts'

export function RecordItem({ entry, question, edit = false, children }: { entry: RecordEntry; question?: Question; edit?: boolean; children?: ReactNode }) {
  const { act, reading, via, reports, lapse } = entry
  return (
    <li className="rounded-xl border-2 border-ink bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <time dateTime={act.occurred_on} className="font-semibold text-ink">
          {formatDate(act.occurred_on)}
        </time>
        <span>·</span>
        <span>{KIND_LABEL[act.kind]}</span>
        {via && via.id !== question?.id && <span className="rounded bg-paper px-1.5 py-0.5">{via.short_title}</span>}
        {reading.bearing === 'indirect' && <IndirectTag />}
        {lapse === 'withdrawn' && act.withdrawn_on && <span className="rounded bg-paper px-1.5 py-0.5">Withdrawn {formatDate(act.withdrawn_on)}</span>}
        {lapse === 'closed' && via && <span className="rounded bg-paper px-1.5 py-0.5">{via.short_title} has closed</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${STANDING_BG[reading.position]}`} />
          {POSITION_LABEL[reading.position]}
        </span>
      </div>
      <ActWords kind={act.kind} words={act.body} />
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {reports.map(({ report, source }) => (
          <li key={report.id}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="link">
                {sourceLabel(source)} ↗
              </a>
            ) : (
              <span className="text-muted">{sourceLabel(source)}</span>
            )}
            <ArchivedCopy source={source} />
            {edit && <ArchiveControls source={source} />}
          </li>
        ))}
      </ul>
      {children}
    </li>
  )
}

export function IndirectTag() {
  return (
    <span className="rounded border border-dashed border-line px-1.5 py-0.5" title="About something else, but it tells you something here.">
      Indirect
    </span>
  )
}

export function ActWords({ kind, words }: { kind: Act['kind']; words: string }) {
  return kind !== 'says' ? (
    <p>{words}</p>
  ) : (
    <blockquote className="border-l-2 border-accent pl-3 font-display text-lg leading-snug">“{words}”</blockquote>
  )
}

export function ArchivedCopy({ source }: { source: Pick<Source, 'archive_url'> }) {
  if (!source.archive_url) return null
  return (
    <>
      {' '}
      <a href={source.archive_url} target="_blank" rel="noreferrer" className="text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
        archived
      </a>
    </>
  )
}
