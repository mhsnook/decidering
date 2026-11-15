import { createPartyDb, partyTransport } from 'party-db/client'
import { allCollections } from '../../shared/schema.ts'
import { editorToken } from './editor.ts'

const transport = partyTransport({
  host: window.location.host,
  party: 'tracker',
  room: 'main',
  token: editorToken,
})

const party = createPartyDb(transport, [...allCollections])

export const db = party.db
export const persist = party.persist
export const onAuthError = party.onAuthError
