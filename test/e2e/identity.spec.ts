import { expect, test, type Browser, type Page } from '@playwright/test'
import { query } from './db.ts'
import { editorToken } from './fixtures.ts'

const person = '/q/free-ferry/bartholomew-sato'

// Locally the email binding delivers nothing, so the code is read from where
// Better Auth keeps it: `<code>:<attempts>`, under the address it was sent to.
const codeFor = (email: string) => query<{ value: string }>(`SELECT value FROM auth_verifications WHERE identifier = 'sign-in-otp-${email}'`)[0].value.split(':')[0]

async function asEditor(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  await context.addInitScript((token) => localStorage.setItem('sporelight.editor-token', token), editorToken())
  return context.newPage()
}

test('a reader signs in with an emailed code, comments under a name of their own, and is hidden from readers once an editor mutes them', async ({ page, browser }) => {
  const stamp = Date.now()
  const email = `reader-${stamp}@example.org`
  const name = `Reader ${stamp}`
  const body = `Is there a recording of this? (${stamp})`

  await page.goto(person)
  const header = page.getByRole('banner')
  await header.getByRole('button', { name: 'Sign in' }).click()
  const signIn = page.getByRole('dialog').filter({ hasText: 'We email you a code' })
  await signIn.getByLabel('Email address').fill(email)
  await signIn.getByRole('button', { name: 'Email me a code' }).click()
  await expect(signIn.getByText(`We sent a code to ${email}`)).toBeVisible()
  await signIn.getByLabel('Code').fill(codeFor(email))
  await signIn.getByRole('button', { name: 'Sign in' }).click()
  await expect(header.getByRole('button', { name: 'Sign out' })).toBeVisible()

  // The first comment asks for the name the person will be shown under.
  await page.getByLabel('Comment').fill(body)
  await page.getByRole('button', { name: 'Post comment' }).click()
  const naming = page.getByRole('dialog').filter({ hasText: 'in place of your email address' })
  await naming.getByLabel('Username').fill(name)
  await naming.getByRole('button', { name: 'Save and post' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: body })).toContainText(name)
  await expect(header.getByText(name)).toBeVisible()
  await expect(page.getByText(email)).toHaveCount(0)
  const [posted] = query<{ email: string }>(`SELECT u.email FROM comments c JOIN auth_users u ON u.id = c.person_id WHERE c.body = '${body}'`)
  expect(posted.email).toBe(email)

  const editor = await asEditor(browser)
  await editor.goto(person)
  const theirs = editor.getByRole('listitem').filter({ hasText: body })
  await theirs.getByRole('button', { name: `Mute ${name}` }).click()
  await expect(theirs.getByText('Muted · hidden from readers')).toBeVisible()

  // Another reader, signed out, no longer sees it; once unmuted, they do.
  const reader = await (await browser.newContext()).newPage()
  await reader.goto(person)
  await expect(reader.getByRole('heading', { name: 'Discussion' })).toBeVisible()
  await expect(reader.getByText(body)).toHaveCount(0)
  await theirs.getByRole('button', { name: `Unmute ${name}` }).click()
  await expect(reader.getByText(body)).toBeVisible()

  await header.getByRole('button', { name: 'Sign out' }).click()
  await expect(header.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
