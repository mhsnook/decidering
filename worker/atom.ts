import type { FeedEntry } from '../src/lib/feed.ts'
import { KIND_LABEL, readingLabel } from '../src/lib/position.ts'

// XML 1.0 allows no control characters but tab, newline and carriage return,
// and no unpaired surrogates, even escaped, so they are dropped rather than escaped.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function xmlEscape(text: string): string {
  return text
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export type AtomMeta = {
  origin: string
  title: string
  // Both are paths with any query, on `origin`.
  self: string
  page: string
}

const pageOf = (origin: string, entry: FeedEntry) =>
  `${origin}/q/${encodeURIComponent(entry.readings[0].question.slug)}/${encodeURIComponent(entry.decider.slug)}`

function entryText(entry: FeedEntry): string {
  const { act } = entry
  const lines = [
    act.kind === 'says' ? `“${act.body}”` : act.body,
    '',
    ...entry.readings.map(
      ({ reading, question, via }) =>
        `${question.short_title}: ${readingLabel(reading.position, question)}${via ? ` (through ${via.short_title})` : ''}${reading.bearing === 'indirect' ? ' (indirect)' : ''}`,
    ),
    '',
    `${KIND_LABEL[act.kind]} on ${act.occurred_on}${act.withdrawn_on ? `, withdrawn ${act.withdrawn_on}` : ''}.`,
    ...entry.reports.map(({ source }) => (source.url ? `Source: ${source.title ? `${source.title} ` : ''}${source.url}` : `Source: ${source.title ?? 'a document with no public link'}`)),
    ...(entry.isDemo ? ['Demo data, not real.'] : []),
  ]
  return lines.join('\n')
}

export function atomFeed(entries: FeedEntry[], meta: AtomMeta): string {
  const x = xmlEscape
  const updated = entries.reduce((latest, e) => (e.enteredAt > latest ? e.enteredAt : latest), '1970-01-01T00:00:00.000Z')
  const body = entries.map((entry) => {
    const topics = [...new Set(entry.readings.map((r) => r.question.short_title))].join(', ')
    return [
      '  <entry>',
      `    <id>urn:sporelight:act:${x(encodeURIComponent(entry.act.id))}</id>`,
      `    <title>${x(`${entry.decider.name}: ${KIND_LABEL[entry.act.kind].toLowerCase()} on ${topics}`)}</title>`,
      `    <link rel="alternate" type="text/html" href="${x(pageOf(meta.origin, entry))}"/>`,
      ...entry.reports.flatMap(({ source }) => (source.url ? [`    <link rel="related" href="${x(source.url)}"/>`] : [])),
      `    <published>${x(entry.enteredAt)}</published>`,
      `    <updated>${x(entry.enteredAt)}</updated>`,
      `    <content type="text">${x(entryText(entry))}</content>`,
      '  </entry>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${x(meta.title)}</title>`,
    `  <id>${x(meta.origin + meta.self)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${x(meta.origin + meta.self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${x(meta.origin + meta.page)}"/>`,
    `  <updated>${x(updated)}</updated>`,
    '  <author><name>Sporelight</name></author>',
    ...body,
    '</feed>',
    '',
  ].join('\n')
}
