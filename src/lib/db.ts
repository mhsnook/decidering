import { createPartyDb, partyTransport } from 'party-db/client'
import type { Collection } from '@tanstack/db'
import {
  allCollections,
  type Body,
  type Decider,
  type Evidence,
  type Question,
  type Role,
  type Seat,
  type Stance,
  type Submission,
} from '../../shared/schema.ts'
import { editorToken } from './editor.ts'

const transport = partyTransport({
  host: window.location.host,
  party: 'tracker',
  room: 'main',
  token: editorToken,
})

const party = createPartyDb(transport, [...allCollections])

type C<T extends object> = Collection<T, string>
export const db = party.db as unknown as {
  bodies: C<Body>
  deciders: C<Decider>
  seats: C<Seat>
  roles: C<Role>
  questions: C<Question>
  stances: C<Stance>
  evidence: C<Evidence>
  submissions: C<Submission>
}
export const persist = party.persist
export const onAuthError = party.onAuthError
