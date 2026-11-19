import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// "Today" in the app is the browser's date, and the next-term toggle only shows
// while a body's next term lies ahead. Fixing the clock keeps these flows
// meaning the same thing after the 120th Congress starts on 2027-01-03.
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

// The counts in a chart's accessible name, e.g. "House. Support: 120, Oppose: 3. 218 is a majority."
async function chart(figure: Locator) {
  const label = (await figure.getByRole('img').getAttribute('aria-label')) ?? ''
  const summary = label.split('. ')[1] ?? ''
  const counts = [...summary.matchAll(/: (\d+)/g)].map((m) => Number(m[1]))
  const caption = (await figure.locator('figcaption p').textContent()) ?? ''
  return {
    label,
    counted: counts.reduce((a, b) => a + b, 0),
    seats: Number(caption.match(/^(\d+) voting/)?.[1]),
    dots: await figure.locator('svg[role="img"] > g').count(),
    supportShown: Number(await figure.locator('p.pointer-events-none span').first().textContent()),
    supportCounted: Number(label.match(/(?:Support|Yes|Signed on|Ratified)[^:]*: (\d+)/i)?.[1] ?? 0),
  }
}

async function standingTotals(page: Page) {
  const buttons = page.locator('main button:has(span.text-3xl)')
  const values = await buttons.locator('span.text-3xl').allTextContents()
  const shown = (await page.getByText(/^\d+ of \d+$/).textContent()) ?? ''
  const [, visible, of] = shown.match(/^(\d+) of (\d+)$/) ?? []
  return { sum: values.map(Number).reduce((a, b) => a + b, 0), visible: Number(visible), of: Number(of) }
}

test('a question page draws a seat chart per chamber and the counts add up', async ({ page }) => {
  await page.goto('/q/medicare-for-all')
  const figures = page.locator('figure')
  await expect(figures).toHaveCount(2)

  const house = await chart(figures.filter({ has: page.getByRole('heading', { name: 'House' }) }))
  const senate = await chart(figures.filter({ has: page.getByRole('heading', { name: 'Senate' }) }))
  for (const c of [house, senate]) {
    expect(c.dots, c.label).toBe(c.seats)
    expect(c.counted, c.label).toBe(c.seats)
    expect(c.supportShown, c.label).toBe(c.supportCounted)
    expect(c.supportCounted, c.label).toBeGreaterThan(0)
  }
  await expect(figures.first()).toContainText(`${Math.floor(house.seats / 2) + 1} is a majority`)
  await expect(figures.nth(1)).toContainText(`${Math.floor(senate.seats / 2) + 1} is a majority`)

  // Every one of the 541 seats is drawn, held without a vote, or listed as open.
  // The seeded roster has two House seats empty until the next Congress.
  await expect(page.getByText('6 non-voting not drawn')).toBeVisible()
  const open = await page.locator('section:has(> h2:text-is("Vacant")) li, section:has(> h2:text-is("Not decided yet")) li').count()
  expect(open).toBe(2)
  expect(house.seats + senate.seats + 6 + open).toBe(541)
  expect(senate.seats).toBe(100)

  // The standing buttons count the seats that are held, drawn or not.
  const totals = await standingTotals(page)
  expect(totals.sum).toBe(totals.of)
  expect(totals.of).toBe(house.seats + senate.seats + 6)
  expect(totals.visible).toBe(totals.of)
})

test('a question with its own threshold draws one chart with that line', async ({ page }) => {
  await page.goto('/q/equal-rights-amendment')
  const figure = page.locator('figure')
  await expect(figure).toHaveCount(1)
  const c = await chart(figure)
  expect(c.dots).toBe(c.seats)
  expect(c.counted).toBe(c.seats)
  await expect(figure).toContainText('38 needed')
  const totals = await standingTotals(page)
  expect(totals.sum).toBe(totals.of)
})

test('evidence a reader sends reaches the editor under its question and, once approved, the record', async ({ page, context }) => {
  const quote = `The ferry should be free, and I will vote to make it so. (${Date.now()})`
  const sourceTitle = `Harbor Ledger: Sato on the ferry ${Date.now()}`
  const person = '/q/free-ferry/bartholomew-sato'

  await page.goto(person)
  await expect(page.getByRole('heading', { name: 'Bartholomew Sato' })).toBeVisible()
  await expect(page.getByText(quote)).toHaveCount(0)
  await page.getByRole('button', { name: 'Add to the record' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('What did Bartholomew Sato say or do?').fill(quote)
  await dialog.getByLabel('Link to the source').fill(`https://example.com/harbor-ledger/sato-${Date.now()}`)
  await dialog.getByLabel('Source name').fill(sourceTitle)
  await dialog.getByLabel('Date it happened').fill('2026-11-12')
  await dialog.getByLabel('What it shows').selectOption('support')
  await dialog.getByLabel('Anything the editor should know?').fill('Third paragraph.')
  await dialog.getByRole('button', { name: 'Send for review' }).click()
  await expect(dialog.getByText('Thanks. An editor will check it against the source.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  // Nothing reaches the record before review.
  await expect(page.getByText(quote)).toHaveCount(0)

  const editor = await context.newPage()
  await editor.goto('/editor')
  await editor.getByLabel('Editor token').fill(editorToken())
  await editor.getByRole('button', { name: 'Sign in' }).click()
  await expect(editor.getByRole('heading', { name: 'Review queue' })).toBeVisible()

  const upNext = editor.getByRole('button').filter({ hasText: quote })
  if (await upNext.count()) await upNext.click()
  await expect(editor.getByRole('heading', { name: sourceTitle })).toBeVisible()
  await expect(editor.getByText('Reader’s note: Third paragraph.')).toBeVisible()
  const item = editor.getByRole('region', { name: 'Item 1: Bartholomew Sato' })
  await expect(item.getByRole('heading', { name: 'Bartholomew Sato' })).toBeVisible()
  await expect(item.getByText('Should the harbor ferry be free to ride?', { exact: true })).toBeVisible()
  await expect(item.getByLabel('Question')).toHaveValue('free-ferry')
  await expect(item.getByLabel('Reader’s quote, not yet checked')).toHaveValue(quote)
  await item.getByLabel('One-line summary').fill('Says he will vote to make the ferry free.')
  await editor.getByRole('button', { name: /Approve and publish/ }).click()
  await expect(editor.getByRole('heading', { name: sourceTitle })).toHaveCount(0)

  await page.goto(person)
  await expect(page.getByText(quote)).toBeVisible()
  await expect(page.getByText('Says he will vote to make the ferry free.')).toBeVisible()
  await expect(page.getByText('Nothing on file.')).toHaveCount(0)
})

test('an item read by a model says its words were found in the article, and shows the model’s note apart from the editor’s', async ({ page, request }) => {
  const stamp = Date.now()
  const now = TODAY.toISOString()
  const ids = { source: `src-${stamp}`, proposal: `prop-${stamp}`, item: `item-${stamp}` }
  const quote = 'I will vote to make the ferry free, and I will say so at every stop.'
  const sourceTitle = `Sato on the ferry ${stamp}`
  // The rows a news search run queues for a model-read article, written here
  // through the editor's party endpoint since no model runs in tests.
  const write = await request.post('/parties/tracker/main?proto=party-db', {
    headers: { authorization: `Bearer ${editorToken()}` },
    data: [
      { channel: 'sources', ops: [{ type: 'insert', value: { id: ids.source, url: `https://example.com/harbor-ledger/model-${stamp}`, title: sourceTitle, publisher: null, published_on: null, kind: null, archive_url: null, stored_copy: null, created_at: now } }] },
      { channel: 'proposals', ops: [{ type: 'insert', value: { id: ids.proposal, source_id: ids.source, origin: 'model', submitted_by: null, status: 'pending', created_at: now, reviewed_at: null } }] },
      {
        channel: 'proposal_items',
        ops: [
          {
            type: 'insert',
            value: { id: ids.item, proposal_id: ids.proposal, sort: 0, decider_id: 'demo-bartholomew-sato', question_id: 'free-ferry', act_id: `act-${stamp}`, kind: 'says', occurred_on: '2026-11-15', quote, reading: 'support', bearing: 'direct', position: null, summary: 'Says he will vote for a free ferry.', status: 'pending' },
          },
        ],
      },
      {
        channel: 'proposal_notes',
        ops: [
          { type: 'insert', value: { id: `note-${stamp}`, proposal_id: ids.proposal, proposal_item_id: null, kind: 'submitter', body: 'Read by a test model.', created_at: now } },
          { type: 'insert', value: { id: `note-item-${stamp}`, proposal_id: ids.proposal, proposal_item_id: ids.item, kind: 'submitter', body: "Model's reason: He says how he will vote.", created_at: now } },
        ],
      },
    ],
  })
  expect(write.ok()).toBe(true)

  await page.goto('/editor')
  await page.getByLabel('Editor token').fill(editorToken())
  await page.getByRole('button', { name: 'Sign in' }).click()
  const upNext = page.getByRole('button').filter({ hasText: sourceTitle })
  if (await upNext.count()) await upNext.click()
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible()
  await expect(page.getByText('Read by a model ·')).toBeVisible()
  await expect(page.getByText('Note: Read by a test model.')).toBeVisible()
  const item = page.getByRole('region', { name: 'Item 1: Bartholomew Sato' })
  await expect(item.getByLabel('Found in the article text by a model; check what it shows')).toHaveValue(quote)
  await expect(item.getByText("Model's reason: He says how he will vote.")).toBeVisible()
  // The model's note is its own, not the editor's note on the item.
  await expect(item.getByLabel(/Note on this item/)).toHaveValue('')
  await expect(item.getByLabel('One-line summary')).toHaveValue('Says he will vote for a free ferry.')
})

test('choosing the next term shows the viewing-another-day strip, and its link returns to today', async ({ page }) => {
  await page.goto('/q/medicare-for-all')
  const strip = page.getByRole('status').filter({ hasText: /^Viewing/ })
  await expect(page.getByRole('button', { name: 'Now', pressed: true })).toBeVisible()
  await expect(strip).toHaveCount(0)

  await page.getByRole('button', { name: '120th Congress' }).click()
  await expect(page).toHaveURL(/[?&]as=2027-01-03/)
  await expect(strip).toBeVisible()
  await expect(strip).toContainText('as expected')
  await expect(page.getByRole('button', { name: '120th Congress', pressed: true })).toBeVisible()

  // The day viewed rides along on links to other pages.
  await page.getByRole('link', { name: 'Questions', exact: true }).first().click()
  await expect(page).toHaveURL(/[?&]as=2027-01-03/)
  await expect(strip).toBeVisible()

  await strip.getByRole('link', { name: 'Back to today' }).click()
  await expect(strip).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]as=/)
})
