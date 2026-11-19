import { expect, test, type Locator, type Page } from '@playwright/test'
import { SPECTRUM, STANDINGS, STANDING_COLOR, standingLabel, type Standing } from '../../src/lib/position.ts'
import { query } from './db.ts'
import { TODAY, editorToken, partyWrite } from './fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(TODAY)
})

const DAY = TODAY.toISOString().slice(0, 10)

type Dot = { x: number; y: number; standing: Standing; lit: boolean }

// Every drawn seat, read off the SVG: where it sits and which standing its colour is.
async function dots(figure: Locator): Promise<Dot[]> {
  const byColour = new Map(STANDINGS.map((s) => [STANDING_COLOR[s], s]))
  const raw = await figure.locator('svg[role="img"] > g').evaluateAll((groups) =>
    groups.map((g) => {
      const face = g.querySelectorAll('circle')[g.querySelectorAll('circle').length - 1]
      return { x: Number(face.getAttribute('cx')), y: Number(face.getAttribute('cy')), fill: face.getAttribute('fill') ?? '', lit: g.getAttribute('opacity') === '1' }
    }),
  )
  return raw.map((d) => ({ x: d.x, y: d.y, lit: d.lit, standing: d.fill === 'none' ? 'unknown' : byColour.get(d.fill)! }))
}

const angle = (d: Dot) => Math.atan2(-d.y, d.x)

// The per-standing counts in a chart's accessible name, e.g. "House. Yes: 120, No: 3. 218 is a majority."
async function chartCounts(figure: Locator, question: { kind: 'position' | 'formal_act'; act_label: string | null }) {
  const label = (await figure.getByRole('img').getAttribute('aria-label')) ?? ''
  const counts = new Map<Standing, number>()
  for (const s of SPECTRUM) {
    const n = label.match(new RegExp(`(?:\\. |, )${standingLabel(s, question)}: (\\d+)`))?.[1]
    if (n) counts.set(s, Number(n))
  }
  return counts
}

// The count on each standing button above the seat list.
async function buttonCounts(page: Page, question: { kind: 'position' | 'formal_act'; act_label: string | null }) {
  const counts = new Map<Standing, number>()
  for (const s of SPECTRUM) {
    const button = page.getByRole('button', { name: new RegExp(`^${standingLabel(s, question)}\\s*\\d+$`) })
    if (await button.count()) counts.set(s, Number((await button.textContent())!.match(/(\d+)$/)![1]))
  }
  return counts
}

const sum = (m: Map<unknown, number>) => [...m.values()].reduce((a, b) => a + b, 0)

test('a question page draws each chamber in standing order, and every seat is accounted for', async ({ page }) => {
  const [question] = query<{ kind: 'position'; act_label: null }>(`SELECT kind, act_label FROM questions WHERE slug = 'medicare-for-all'`)
  const seats = query<{ chamber: string; is_voting: number; n: number }>(`SELECT chamber, is_voting, COUNT(*) AS n FROM seats WHERE body_id = 'us-congress' GROUP BY 1, 2`)
  const inDb = (chamber: string, voting: number) => seats.find((r) => r.chamber === chamber && r.is_voting === voting)?.n ?? 0

  await page.goto('/q/medicare-for-all')
  const figures = page.locator('figure')
  await expect(figures).toHaveCount(2)

  const drawn = { House: 0, Senate: 0 }
  for (const chamber of ['House', 'Senate'] as const) {
    const figure = figures.filter({ has: page.getByRole('heading', { name: chamber }) })
    const seen = await dots(figure)
    drawn[chamber] = seen.length
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.length).toBeLessThanOrEqual(inDb(chamber, 1))

    // Support on the left, opposition on the right, the undecided between.
    const order = [...seen].sort((a, b) => angle(b) - angle(a)).map((d) => SPECTRUM.indexOf(d.standing))
    expect(order).toEqual([...order].sort((a, b) => a - b))

    // The accessible name says what is drawn.
    const told = await chartCounts(figure, question)
    for (const s of SPECTRUM) expect(told.get(s) ?? 0, `${chamber} ${s}`).toBe(seen.filter((d) => d.standing === s).length)
    expect(Number(await figure.getByText(standingLabel('support', question).toLowerCase(), { exact: true }).locator('xpath=preceding-sibling::span').textContent())).toBe(told.get('support') ?? 0)
  }

  // Every seat in the body is drawn, held without a vote and listed below, or listed as open.
  const nonVoting = Number((await page.getByText(/\d+ non-voting not drawn/).textContent())!.match(/(\d+) non-voting/)![1])
  expect(nonVoting).toBe(inDb('House', 0) + inDb('Senate', 0))
  const open = await page.locator('section:has(> h2:text-is("Vacant")) li, section:has(> h2:text-is("Not decided yet")) li').count()
  expect(drawn.House + drawn.Senate + nonVoting + open).toBe(seats.reduce((a, r) => a + r.n, 0))

  // The buttons count every held seat; the charts leave out the non-voting ones.
  const buttons = await buttonCounts(page, question)
  expect(sum(buttons)).toBe(drawn.House + drawn.Senate + nonVoting)
  await expect(page.getByText(new RegExp(`^${sum(buttons)} of ${sum(buttons)}$`))).toBeVisible()
})

test("a member's seat is lit in the colour of their stance when searched for", async ({ page }) => {
  // A sitting council member whose stance on file is something other than support.
  const [member] = query<{ name: string; position: Standing }>(`
    SELECT d.name, st.position FROM stances st
    JOIN deciders d ON d.id = st.decider_id
    JOIN roles r ON r.decider_id = d.id JOIN seats s ON s.id = r.seat_id
    WHERE st.question_id = 'free-ferry' AND st.position <> 'support' AND s.body_id = 'harbor-city-council' AND s.is_voting = 1 AND r.certainty = 'certain'
      AND (r.starts_on IS NULL OR r.starts_on <= '${DAY}') AND (r.ends_on IS NULL OR r.ends_on > '${DAY}')
    ORDER BY d.sort_name LIMIT 1`)
  expect(member, 'the seed has a council member with a stance other than support').toBeDefined()

  await page.goto('/q/free-ferry')
  const figure = page.locator('figure')
  await expect(figure.locator('svg[role="img"] > g').first()).toBeVisible()
  expect(new Set((await dots(figure)).map((d) => d.standing)).size, 'the chart shows more than one standing').toBeGreaterThan(1)
  await page.getByRole('searchbox', { name: 'Search' }).fill(member.name)
  await expect.poll(async () => (await dots(figure)).filter((d) => d.lit).map((d) => d.standing)).toEqual([member.position])
})

test('a question with its own threshold puts the line there, not at a majority', async ({ page }) => {
  const [question] = query<{ kind: 'formal_act'; act_label: string | null; threshold: number }>(`SELECT kind, act_label, threshold FROM questions WHERE slug = 'equal-rights-amendment'`)
  await page.goto('/q/equal-rights-amendment')
  const figure = page.locator('figure')
  await expect(figure).toHaveCount(1)
  const seen = await dots(figure)
  expect(question.threshold).not.toBe(Math.floor(seen.length / 2) + 1)
  await expect(figure).toContainText(`${question.threshold} needed`)
  await expect(figure).not.toContainText('is a majority')
  const told = await chartCounts(figure, question)
  expect(sum(told)).toBe(seen.length)
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
  await editor.getByLabel('Editor token').fill(`${editorToken()}x`)
  await editor.getByRole('button', { name: 'Sign in' }).click()
  await expect(editor.getByText('That token was not accepted.')).toBeVisible()
  await expect(editor.getByRole('heading', { name: 'Review queue' })).toHaveCount(0)
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
  await expect(page.locator('section.card').getByText(standingLabel('support', { kind: 'position', act_label: null }), { exact: true })).toBeVisible()
})

test('an item read by a model says its words were found in the article, and shows the model’s note apart from the editor’s', async ({ page, request }) => {
  const stamp = Date.now()
  const now = TODAY.toISOString()
  const ids = { source: `src-${stamp}`, proposal: `prop-${stamp}`, item: `item-${stamp}` }
  const quote = 'I will vote to make the ferry free, and I will say so at every stop.'
  const sourceTitle = `Sato on the ferry ${stamp}`
  // The rows a news search run queues for a model-read article, written here
  // through the editor's party endpoint since no model runs in tests.
  const write = await partyWrite(request, [
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
  ])
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
  const [body] = query<{ next_term_on: string; next_term_label: string }>(`SELECT next_term_on, next_term_label FROM bodies WHERE id = 'us-congress'`)
  expect(body.next_term_on > DAY, 'the next term lies ahead of the fixed clock').toBe(true)
  await page.goto('/q/medicare-for-all')
  const strip = page.getByRole('status').filter({ hasText: /^Viewing/ })
  await expect(page.getByRole('button', { name: 'Now', pressed: true })).toBeVisible()
  await expect(strip).toHaveCount(0)

  await page.getByRole('button', { name: body.next_term_label }).click()
  await expect(page).toHaveURL(new RegExp(`[?&]as=${body.next_term_on}`))
  await expect(strip).toBeVisible()
  await expect(strip).toContainText('as expected')
  await expect(page.getByRole('button', { name: body.next_term_label, pressed: true })).toBeVisible()

  // The day viewed rides along on links to other pages.
  await page.getByRole('link', { name: 'Questions', exact: true }).first().click()
  await expect(page).toHaveURL(new RegExp(`[?&]as=${body.next_term_on}`))
  await expect(strip).toBeVisible()

  await strip.getByRole('link', { name: 'Back to today' }).click()
  await expect(strip).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]as=/)
})
