import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const TODAY = new Date('2026-11-19T15:00:00Z')

const editorToken = () => {
  const vars = readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8')
  const token = vars.match(/^EDITOR_TOKEN=(.*)$/m)?.[1]?.trim()
  if (!token) throw new Error('EDITOR_TOKEN is not set in .dev.vars')
  return token
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(TODAY)
})

type Frame = { channel?: string; ops?: { value: Record<string, unknown> }[]; subscribe?: string }

// Every party-db frame the page sends and is sent.
function recordFrames(page: Page) {
  const sent: Frame[] = []
  const received: Frame[] = []
  const parse = (payload: string | Buffer, into: Frame[]) => {
    try {
      into.push(JSON.parse(String(payload)))
    } catch {
      // partysocket pings are not JSON
    }
  }
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => parse(f.payload, sent))
    ws.on('framereceived', (f) => parse(f.payload, received))
  })
  return {
    rowsOn: (channel: string) => received.filter((f) => f.channel === channel).flatMap((f) => f.ops?.map((op) => op.value) ?? []),
    subscribedTo: (channel: string) => sent.some((f) => f.subscribe === channel),
  }
}

test('the feed lists the record newest first, and its filters live in the URL', async ({ page }) => {
  await page.goto('/q/free-ferry')
  await page.getByRole('link', { name: 'Latest on this question' }).click()
  await expect(page).toHaveURL(/\/latest\?question=free-ferry$/)
  await expect(page.getByRole('heading', { name: 'Latest', exact: true })).toBeVisible()
  await expect(page.getByLabel('Question')).toHaveValue('free-ferry')

  const published = page.getByRole('region', { name: 'On the record' })
  const entries = published.getByRole('listitem').filter({ has: page.locator('blockquote, p') })
  await expect(entries.first()).toBeVisible()
  // Every entry links to the person's page on the question it is read on.
  const links = await published.locator('a[href^="/q/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  expect(links.length).toBeGreaterThan(0)
  for (const href of links) expect(href).toMatch(/^\/q\/[^/]+\/[^/?]+/)

  await page.getByLabel('Body').selectOption('harbor-port-authority')
  await expect(page).toHaveURL(/body=harbor-port-authority/)
  await expect(page).toHaveURL(/question=free-ferry/)

  await page.getByLabel('Question').selectOption('')
  await expect(page).not.toHaveURL(/question=/)
  await page.getByLabel('Body').selectOption('')
  await expect(page).not.toHaveURL(/body=/)

  // The national record pages: 50 entries, then a link to older ones.
  await expect(published.locator('ol > li')).toHaveCount(50)
  await published.getByRole('link', { name: 'Older entries' }).click()
  await expect(page).toHaveURL(/before=/)
  await expect(published.getByRole('link', { name: 'Back to the newest' })).toBeVisible()
})

test('a feed link to a question that does not exist says so instead of showing everything', async ({ page }) => {
  await page.goto('/latest?question=no-such-question')
  await expect(page.getByText('No question here.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'On the record' })).toHaveCount(0)
  await page.getByRole('link', { name: 'See everything that is new' }).click()
  await expect(page).toHaveURL(/\/latest$/)
  await expect(page.getByRole('region', { name: 'On the record' })).toBeVisible()
})

test('the Atom feed is linked from the page and carries the published record', async ({ page, request }) => {
  await page.goto('/latest?question=free-ferry')
  await expect(page.locator('head link[rel="alternate"][type="application/atom+xml"]')).toHaveAttribute('href', '/feed.xml?question=free-ferry')
  await expect(page.getByRole('link', { name: 'Atom feed of this selection' })).toHaveAttribute('href', '/feed.xml?question=free-ferry')

  const res = await request.get('/feed.xml?question=free-ferry')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('application/atom+xml; charset=utf-8')
  const xml = await res.text()
  expect(xml).toContain('The ferry is a bridge we forgot to build.')
  expect(xml.match(/<entry>/g)?.length).toBeGreaterThan(0)
})

let cleanup: (() => Promise<unknown>) | undefined
test.afterEach(async () => {
  const res = (await cleanup?.()) as { ok(): boolean } | undefined
  if (res) expect(res.ok()).toBe(true)
  cleanup = undefined
})

test('with the mode off a reader is sent no proposals; turned on, it shows what is waiting, marked as unchecked', async ({ page, request }) => {
  const stamp = Date.now()
  const now = TODAY.toISOString()
  const claimed = `I back a free ferry and will vote for it, every time. (${stamp})`
  const rejected = `A claim an editor turned down. (${stamp})`
  const lead = `An excerpt that names Sato and claims nothing. (${stamp})`
  const names = ['claim', 'rej', 'lead']

  const item = (id: string, proposal: string, quote: string, reading: string | null, status: string) => ({
    type: 'insert',
    value: { id, proposal_id: proposal, sort: 0, decider_id: 'demo-bartholomew-sato', question_id: 'free-ferry', act_id: `act-${id}`, kind: 'says', occurred_on: null, quote, reading, bearing: 'direct', position: null, summary: null, status },
  })
  const source = (id: string) => ({ type: 'insert', value: { id, url: `https://example.com/${id}`, title: id, publisher: null, published_on: null, kind: null, archive_url: null, stored_copy: null, created_at: now } })
  const proposal = (id: string, sourceId: string, origin: string) => ({ type: 'insert', value: { id, source_id: sourceId, origin, submitted_by: null, status: 'pending', created_at: now, reviewed_at: null } })
  const write = await request.post('/parties/tracker/main?proto=party-db', {
    headers: { authorization: `Bearer ${editorToken()}` },
    data: [
      { channel: 'sources', ops: names.map((n) => source(`${n}-${stamp}`)) },
      { channel: 'proposals', ops: [proposal(`p-claim-${stamp}`, `claim-${stamp}`, 'reader'), proposal(`p-rej-${stamp}`, `rej-${stamp}`, 'reader'), proposal(`p-lead-${stamp}`, `lead-${stamp}`, 'news_search')] },
      {
        channel: 'proposal_items',
        ops: [
          item(`i-claim-${stamp}`, `p-claim-${stamp}`, claimed, 'support', 'pending'),
          item(`i-rej-${stamp}`, `p-rej-${stamp}`, rejected, 'oppose', 'rejected'),
          item(`i-lead-${stamp}`, `p-lead-${stamp}`, lead, null, 'pending'),
        ],
      },
      { channel: 'proposal_notes', ops: [{ type: 'insert', value: { id: `note-${stamp}`, proposal_id: `p-claim-${stamp}`, proposal_item_id: null, kind: 'submitter', body: 'Only editors read this note.', created_at: now } }] },
    ],
  })
  expect(write.ok()).toBe(true)
  // The editor flows expect the queue to hold only what they put there.
  const remove = (channel: string, ids: string[]) => ({ channel, ops: ids.map((id) => ({ type: 'delete', value: { id } })) })
  cleanup = () =>
    request.post('/parties/tracker/main?proto=party-db', {
      headers: { authorization: `Bearer ${editorToken()}` },
      data: [
        remove('proposal_notes', [`note-${stamp}`]),
        remove('proposal_items', names.map((n) => `i-${n}-${stamp}`)),
        remove('proposals', names.map((n) => `p-${n}-${stamp}`)),
        remove('sources', names.map((n) => `${n}-${stamp}`)),
      ],
    })

  const frames = recordFrames(page)
  await page.goto('/latest')
  const published = page.getByRole('region', { name: 'On the record' })
  await expect(published.locator('ol > li').first()).toBeVisible()
  await expect(page.getByRole('region', { name: 'Waiting for review' })).toHaveCount(0)
  expect(frames.subscribedTo('proposals')).toBe(false)
  expect(frames.subscribedTo('proposal_items')).toBe(false)
  expect(frames.rowsOn('proposals')).toEqual([])
  expect(frames.rowsOn('proposal_items')).toEqual([])

  await page.getByRole('button', { name: 'Also show what is waiting for review' }).click()
  await expect(page).toHaveURL(/waiting=true/)
  const waiting = page.getByRole('region', { name: 'Waiting for review' })
  const entry = waiting.getByRole('listitem').filter({ hasText: claimed })
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('Not checked yet · Sent in by a reader')
  await expect(entry).toContainText('Claimed:')
  await expect(page.getByText(rejected)).toHaveCount(0)
  await expect(page.getByText(lead)).toHaveCount(0)
  await expect(page.getByText('Only editors read this note.')).toHaveCount(0)
  await expect(published.getByText(claimed)).toHaveCount(0)
  expect(frames.subscribedTo('proposal_items')).toBe(true)
  expect(frames.rowsOn('proposal_items').map((i) => i.quote)).toContain(claimed)
  expect(frames.rowsOn('proposal_notes')).toEqual([])

  // In the URL, so a reload keeps it.
  await page.reload()
  await expect(page.getByRole('region', { name: 'Waiting for review' }).getByText(claimed)).toBeVisible()

  const feed = await (await request.get('/feed.xml')).text()
  expect(feed).not.toContain(claimed)
})
