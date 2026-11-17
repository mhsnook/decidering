import type { Question } from '../../shared/schema.ts'
import { isRecordedAct } from '../../shared/standing.ts'
import type { RecordEntry } from '../lib/tracker.tsx'
import { KIND_LABEL, SIGNAL_LABEL, STANDING_BG, formatDate } from '../lib/position.ts'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function RecordItem({ entry, question }: { entry: RecordEntry; question?: Question }) {
  const { act, reading, via, reports } = entry
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <time dateTime={act.occurred_on} className="font-semibold text-ink">
          {formatDate(act.occurred_on)}
        </time>
        <span>·</span>
        <span>{KIND_LABEL[act.kind]}</span>
        {via && via.id !== question?.id && <span className="rounded bg-paper px-1.5 py-0.5">{via.short_title}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${STANDING_BG[reading.position]}`} />
          {SIGNAL_LABEL[reading.position]}
        </span>
      </div>
      {isRecordedAct(act.kind) ? (
        <p>{act.body}</p>
      ) : (
        <blockquote className="border-l-2 border-accent pl-3 font-display text-lg leading-snug">“{act.body}”</blockquote>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {reports.map(({ report, source }) => (
          <li key={report.id}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                {source.title ?? hostOf(source.url)} ↗
              </a>
            ) : (
              <span className="text-muted">{source.title ?? 'A document with no public link'}</span>
            )}
          </li>
        ))}
      </ul>
    </li>
  )
}
