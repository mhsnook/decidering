import type { APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'

// "Today" in the app is the browser's date, and the next-term toggle only shows
// while a body's next term lies ahead. Fixing the clock keeps these flows
// meaning the same thing after the 120th Congress starts on 2027-01-03.
export const TODAY = new Date('2026-11-19T15:00:00Z')

export const editorToken = () => {
  const vars = readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8')
  const token = vars.match(/^EDITOR_TOKEN=(.*)$/m)?.[1]?.trim()
  if (!token) throw new Error('EDITOR_TOKEN is not set in .dev.vars')
  return token
}

// Writes batches through the editor's party endpoint, as the editor's browser does.
export const partyWrite = (request: APIRequestContext, data: unknown) =>
  request.post('/parties/tracker/main?proto=party-db', { headers: { authorization: `Bearer ${editorToken()}` }, data })
