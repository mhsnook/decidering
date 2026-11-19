// Getting a Wayback Machine capture of each published source and storing its
// address in sources.archive_url.
//
// Two Internet Archive interfaces are used:
//   the availability API (archive.org/wayback/available), which needs no key and
//     returns the capture closest to a timestamp;
//   Save Page Now 2 (web.archive.org/save), which needs an archive.org S3 key and
//     starts a capture job, and whose status endpoint reports how the job went.

const AVAILABILITY = 'https://archive.org/wayback/available'
const SAVE = 'https://web.archive.org/save'

// Sources looked at in one scheduled run. Each costs at most three outside
// requests (a lookup, a capture request and a status check), so a run makes at
// most 15. See "Calls per run" in the README for how this fits beside the news
// search under the Workers Free limit of 50.
export const MAX_ARCHIVE_SOURCES_PER_RUN = 5
// The availability API answered 429 to a handful of requests a second apart, so
// requests to the archive are spaced.
const REQUEST_SPACING_MS = 3_000
// How long the scheduled pass waits before asking how its capture jobs went.
// Save Page Now gives up on a capture after two minutes.
export const CAPTURE_WAIT_MS = 90_000
// An editor's "archive now" waits for its one job by asking this many times,
// this far apart.
const EDITOR_POLLS = 6
const EDITOR_POLL_MS = 5_000

const MAX_FAILURES = 6
const FIRST_RETRY_HOURS = 12
const NO_KEY_RETRY_DAYS = 7
// A capture taken this long before we recorded the source may predate what the
// source says, so it is not used. Any capture after that is: a new one would be
// later still.
const EARLIEST_CAPTURE_DAYS = 30
const DAY_MS = 86_400_000

// Status codes from Save Page Now that mean the page cannot be captured as it
// stands, so asking again on a timer would not help. Other errors are retried.
const REFUSED = new Set([
  'error:not-found',
  'error:no-access',
  'error:unauthorized',
  'error:blocked',
  'error:blocked-url',
  'error:invalid-url-syntax',
  'error:invalid-host-resolution',
  'error:network-authentication-required',
  'error:filesize-limit',
  'error:method-not-allowed',
])
// Codes that are about our account or the archive as a whole, not the page.
const STOP = new Set(['error:user-session-limit', 'error:max-daily-bandwidth', 'error:max-daily-bandwidth-from-ip', 'error:blocked-client-ip'])

export type Archiver = { setArchiveUrl(sourceId: string, archiveUrl: string): Promise<boolean> }

type Candidate = {
  id: string
  url: string
  created_at: string
  attempts: number | null
  outcome: Outcome | null
  tried_at: string | null
}

type Outcome = 'archived' | 'requested' | 'failed' | 'no_key' | 'gave_up'

export type ArchiveReport = {
  // Sources due when the run started, including those beyond the cap.
  due: number
  looked: number
  found: number
  requested: number
  archived: number
  failed: number
  gave_up: number
  no_key: number
  error?: string
}

type Step =
  | { kind: 'found'; archiveUrl: string }
  | { kind: 'requested'; jobId: string }
  | { kind: 'failed'; detail: string; refused: boolean }
  | { kind: 'no_key' }
  | { kind: 'stop'; reason: string }

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// The key is "accesskey:secret" from archive.org/account/s3.php. An empty value
// means none.
// Read through a cast because `wrangler types` declares the secret only when
// .dev.vars has it, and the key is optional.
function keyOf(env: Env): string | null {
  const key = (env as { ARCHIVE_ORG_KEY?: string }).ARCHIVE_ORG_KEY
  return key?.includes(':') ? key : null
}

const waybackStamp = (date: Date) => date.toISOString().replace(/\D/g, '').slice(0, 14)

function stampDate(stamp: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(stamp)
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : null
}

export const captureUrl = (timestamp: string, original: string) => `https://web.archive.org/web/${timestamp}/${original}`

type Lookup = { ok: true; archiveUrl: string | null } | { ok: false; reason: string }

// The capture closest to `near`, if it is one we would use.
export async function findCapture(url: string, near: Date, recordedAt: Date): Promise<Lookup> {
  const query = new URLSearchParams({ url, timestamp: waybackStamp(near) })
  let res: Response
  try {
    res = await fetch(`${AVAILABILITY}?${query}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  } catch (e) {
    return { ok: false, reason: `The availability API could not be reached (${String(e).slice(0, 120)}).` }
  }
  if (!res.ok) {
    await res.body?.cancel()
    return { ok: false, reason: `The availability API answered ${res.status}.` }
  }
  const body = (await res.json().catch(() => null)) as {
    archived_snapshots?: { closest?: { available?: boolean; status?: string; timestamp?: string; url?: string } }
  } | null
  const closest = body?.archived_snapshots?.closest
  if (!closest?.available || !closest.timestamp || !/^[23]/.test(closest.status ?? '')) return { ok: true, archiveUrl: null }
  const taken = stampDate(closest.timestamp)
  if (!taken || taken.getTime() < recordedAt.getTime() - EARLIEST_CAPTURE_DAYS * DAY_MS) return { ok: true, archiveUrl: null }
  return { ok: true, archiveUrl: closest.url ? closest.url.replace(/^http:\/\//, 'https://') : captureUrl(closest.timestamp, url) }
}

type SaveError = { status?: string; status_ext?: string; message?: string }

function saveError(body: SaveError | null, fallback: string): Step {
  const ext = body?.status_ext ?? ''
  const detail = [ext, body?.message].filter(Boolean).join(': ') || fallback
  if (STOP.has(ext)) return { kind: 'stop', reason: `Save Page Now: ${detail}` }
  return { kind: 'failed', detail, refused: REFUSED.has(ext) || /robots/i.test(body?.message ?? '') }
}

async function requestCapture(url: string, key: string): Promise<Step> {
  let res: Response
  try {
    res = await fetch(SAVE, {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `LOW ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url, skip_first_archive: '1' }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    return { kind: 'failed', detail: `Save Page Now could not be reached (${String(e).slice(0, 120)}).`, refused: false }
  }
  if (res.status === 429) {
    await res.body?.cancel()
    return { kind: 'stop', reason: 'Save Page Now answered 429.' }
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel()
    return { kind: 'stop', reason: `Save Page Now refused the key (${res.status}).` }
  }
  const body = (await res.json().catch(() => null)) as (SaveError & { job_id?: string }) | null
  if (res.ok && body?.job_id) return { kind: 'requested', jobId: body.job_id }
  return saveError(body, `Save Page Now answered ${res.status}.`)
}

type JobStatus = { kind: 'pending' } | Step

async function captureStatus(jobId: string, key: string): Promise<JobStatus> {
  let res: Response
  try {
    res = await fetch(`${SAVE}/status/${encodeURIComponent(jobId)}`, {
      headers: { accept: 'application/json', authorization: `LOW ${key}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { kind: 'pending' }
  }
  const body = (await res.json().catch(() => null)) as (SaveError & { timestamp?: string; original_url?: string }) | null
  if (!res.ok || !body) return { kind: 'pending' }
  if (body.status === 'success' && body.timestamp && body.original_url) return { kind: 'found', archiveUrl: captureUrl(body.timestamp, body.original_url) }
  if (body.status === 'error') return saveError(body, 'The capture failed.')
  return { kind: 'pending' }
}

async function record(
  db: D1Database,
  sourceId: string,
  now: Date,
  outcome: Outcome,
  fields: { attempts: number; nextTryAt: Date | null; jobId?: string | null; detail?: string | null },
) {
  await db
    .prepare(`INSERT OR REPLACE INTO archive_attempts (source_id, attempts, tried_at, outcome, next_try_at, job_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(sourceId, fields.attempts, now.toISOString(), outcome, fields.nextTryAt?.toISOString() ?? null, fields.jobId ?? null, fields.detail?.slice(0, 1000) ?? null)
    .run()
}

// Writes what came of one step and says which outcome that was.
async function settle(env: Env, tracker: Archiver, source: Candidate, step: Exclude<Step, { kind: 'stop' }>, now: Date): Promise<Outcome> {
  const previous = source.attempts ?? 0
  if (step.kind === 'found') {
    await tracker.setArchiveUrl(source.id, step.archiveUrl)
    await record(env.DB, source.id, now, 'archived', { attempts: 0, nextTryAt: null, detail: step.archiveUrl })
    return 'archived'
  }
  if (step.kind === 'requested') {
    // Due again at once, so the next run looks for the capture.
    await record(env.DB, source.id, now, 'requested', { attempts: previous, nextTryAt: now, jobId: step.jobId })
    return 'requested'
  }
  if (step.kind === 'no_key') {
    await record(env.DB, source.id, now, 'no_key', { attempts: previous, nextTryAt: new Date(now.getTime() + NO_KEY_RETRY_DAYS * DAY_MS) })
    return 'no_key'
  }
  const attempts = previous + 1
  const giveUp = step.refused || attempts >= MAX_FAILURES
  const nextTryAt = giveUp ? null : new Date(now.getTime() + FIRST_RETRY_HOURS * 3_600_000 * 2 ** (attempts - 1))
  await record(env.DB, source.id, now, giveUp ? 'gave_up' : 'failed', { attempts, nextTryAt, detail: step.detail })
  return giveUp ? 'gave_up' : 'failed'
}

// Looks for a capture and, failing that, asks for one. Writes nothing.
async function step(source: Candidate, key: string | null, gap: () => Promise<void>): Promise<Step> {
  const recordedAt = new Date(source.created_at)
  const asked = source.outcome === 'requested' && source.tried_at ? new Date(source.tried_at) : null
  const lookup = await findCapture(source.url, asked ?? recordedAt, recordedAt)
  if (!lookup.ok) return { kind: 'stop', reason: lookup.reason }
  if (lookup.archiveUrl) return { kind: 'found', archiveUrl: lookup.archiveUrl }
  // A capture asked for on an earlier run that never appeared counts as a
  // failure, so a page that never captures backs off instead of being asked for
  // again every run.
  if (asked) return { kind: 'failed', detail: `The capture asked for at ${source.tried_at} has not appeared.`, refused: false }
  if (!key) return { kind: 'no_key' }
  await gap()
  return requestCapture(source.url, key)
}

const CANDIDATE_COLUMNS = `s.id, s.url, s.created_at, a.attempts, a.outcome, a.tried_at`
// A published source is one with a report. A source with no URL is never a
// candidate. A source waiting for a key is due as soon as there is one.
const DUE = `
  FROM sources s LEFT JOIN archive_attempts a ON a.source_id = s.id
  WHERE s.url IS NOT NULL AND s.archive_url IS NULL
    AND EXISTS (SELECT 1 FROM reports r WHERE r.source_id = s.id)
    AND (a.source_id IS NULL OR a.next_try_at <= ?1 OR (a.outcome = 'no_key' AND ?2 = 1))`

// The scheduled pass: the oldest sources that are due, up to the cap. Capture
// jobs it starts are checked once after CAPTURE_WAIT_MS; one still running then
// is looked for on the next run.
export async function archiveSources(env: Env, tracker: Archiver, now: Date = new Date(), wait: (ms: number) => Promise<void> = pause): Promise<ArchiveReport> {
  const key = keyOf(env)
  const binds = [now.toISOString(), key ? 1 : 0]
  const [count, due] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n ${DUE}`).bind(...binds),
    env.DB.prepare(`SELECT ${CANDIDATE_COLUMNS} ${DUE} ORDER BY s.created_at, s.id LIMIT ?3`).bind(...binds, MAX_ARCHIVE_SOURCES_PER_RUN),
  ])
  const report: ArchiveReport = { due: (count.results[0] as { n: number }).n, looked: 0, found: 0, requested: 0, archived: 0, failed: 0, gave_up: 0, no_key: 0 }

  let first = true
  const gap = async () => {
    if (!first) await wait(REQUEST_SPACING_MS)
    first = false
  }
  const jobs: { source: Candidate; jobId: string }[] = []
  for (const source of due.results as Candidate[]) {
    await gap()
    const result = await step(source, key, gap)
    if (result.kind === 'stop') {
      report.error = result.reason
      break
    }
    report.looked++
    report[await settle(env, tracker, source, result, now)]++
    if (result.kind === 'found') report.found++
    if (result.kind === 'requested') jobs.push({ source, jobId: result.jobId })
  }

  if (jobs.length && key) {
    await wait(CAPTURE_WAIT_MS)
    for (const { source, jobId } of jobs) {
      const status = await captureStatus(jobId, key)
      if (status.kind === 'stop') {
        report.error ??= status.reason
        break
      }
      if (status.kind !== 'found' && status.kind !== 'failed') continue
      report.requested--
      report[await settle(env, tracker, source, status, now)]++
    }
  }
  return report
}

export type ArchiveNow =
  | { outcome: 'archived'; archive_url: string }
  | { outcome: 'requested' | 'no_key' | 'failed' | 'gave_up' | 'no_url'; detail: string | null }
  | { error: string; status: number }

// An editor's request to archive one source now. It ignores any back-off, and
// waits a little for the capture before leaving it to the scheduled pass.
export async function archiveNow(env: Env, tracker: Archiver, sourceId: string, now: Date = new Date(), wait: (ms: number) => Promise<void> = pause): Promise<ArchiveNow> {
  const row = await env.DB.prepare(`SELECT ${CANDIDATE_COLUMNS}, s.archive_url FROM sources s LEFT JOIN archive_attempts a ON a.source_id = s.id WHERE s.id = ?`)
    .bind(sourceId)
    .first<Candidate & { url: string | null; archive_url: string | null }>()
  if (!row) return { error: 'Unknown source.', status: 404 }
  if (row.archive_url) return { outcome: 'archived', archive_url: row.archive_url }
  if (!row.url) return { outcome: 'no_url', detail: 'This source has no public address to archive.' }
  const source: Candidate = { ...row, url: row.url, outcome: null }
  const key = keyOf(env)

  let result = await step(source, key, () => wait(REQUEST_SPACING_MS))
  if (result.kind === 'stop') return { error: result.reason, status: 502 }
  if (result.kind === 'requested' && key) {
    for (let i = 0; i < EDITOR_POLLS; i++) {
      await wait(EDITOR_POLL_MS)
      const status = await captureStatus(result.jobId, key)
      if (status.kind === 'stop') return { error: status.reason, status: 502 }
      if (status.kind === 'found' || status.kind === 'failed') {
        result = status
        break
      }
    }
  }
  if (result.kind === 'found') {
    await settle(env, tracker, source, result, now)
    return { outcome: 'archived', archive_url: result.archiveUrl }
  }
  const outcome = (await settle(env, tracker, source, result, now)) as Exclude<Outcome, 'archived'>
  return {
    outcome,
    detail:
      result.kind === 'failed'
        ? result.detail
        : result.kind === 'no_key'
          ? 'No capture was found, and the Worker has no archive.org key to ask for one.'
          : 'The capture was asked for and has not finished. The next scheduled run will look for it.',
  }
}
