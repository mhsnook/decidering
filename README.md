# Decidering

A tracker for open questions in front of the people who decide them. For each person and each question it shows where they stand, the statements and acts that position rests on, and how solid that footing is.

The first data set is the United States Congress and Medicare for All. Nothing in the model is specific to either.

## How it works

- **Bodies, seats, roles.** A body (a legislature, a council, a board) has seats. A person holds a seat or is running for it, so challengers sit beside the incumbent they want to replace.
- **Questions, measures and asks.** A question asks where someone stands ("Do they support Medicare for All?"). A measure is a sub-question about one recordable act, put to everyone in the body or chamber ("Have they cosponsored H.R. 3069?"). An ask is a sub-question put to a key role in the body, or to a person by name ("Will they commit to a markup?", asked of the committee chair). It has its own position scale and record, the people it is put to are shown first on the question's page, and an editor closes it when it is resolved or no longer being asked.
- **Offices and terms.** An office is a key role in a body, such as a committee chair, and it outlives its holders. Seats and offices both have dated holders, and a body can name the day its next term starts. A question's page can then be viewed as the body stands now or as it is expected to stand from that day: seats are filled by whoever holds them then, and an ask of an office is put to whoever sits in it then. Each holder keeps their own position and record on the ask.
- **Sources, acts, reports and readings.** A source is an article, press release, official record, transcript or post, one row per URL. An act is one thing a person did or said. A report is a mention of an act in a source, so a statement covered by five articles is one act with five reports. A reading is what an act signals on one question, and one act can read differently on two questions.
- **What counts toward the parent.** A reading on a measure or an ask says nothing about the parent question unless the sub-question is marked as implying support (`implies_parent_support`). Cosponsoring a bill is marked that way, so a supporting reading there is also written on the parent.
- **Footing.** Every position links to dated acts. Footing is derived from them: on the record (a vote or formal act), fresh, established, sparse, stale, or unknown. The rules live in `shared/standing.ts`.
- **Seat charts.** A question's page draws each chamber as a hemicycle, one dot per voting seat, packed so neighbours along a row sit as far apart as the rows do, ordered from support on the left to opposition on the right with the undecided in between. A line marks how many seats carry the question: a simple majority unless the question sets its own threshold, such as 38 of 50 states. It runs between the seats with exactly that many on its left, crossing each row through a gap and curving from one gap to the next, and a bloc that reaches it has the votes. A body with no chambers gets a single chart.
- **Review queue.** A proposal is a suggested set of changes from one source. Each item in it is one act by one person, read on one question, with the position and summary it would leave them with. Readers send in proposals from any person's page, and a scheduled news search adds one for each result that names people on the roster. An editor at `/editor` accepts or rejects each item and publishes the accepted ones together. Nothing reaches the record until then. An editor can also merge two acts that turn out to be the same one.
- **Discussion.** Each person-and-question page has a comment thread. A reader loads and hears only the threads they have open. Comments post under a username the reader picks the first time they post. Editors can remove comments.

## Stack

- Cloudflare Worker + D1, with a React SPA served as static assets
- [party-db](https://github.com/mhsnook/party-db) syncs every public table to the browser over one Durable Object room; pages are live queries over the local copy
- TanStack Router (file-based routes in `src/routes`), TanStack DB, Tailwind
- Cloudflare [Web Search API](https://developers.cloudflare.com/web-search/) with Exa, through AI Gateway, for the news search

Editors write through the same collections with optimistic transactions. Readers get read-only access. Unreviewed proposals are synced to readers too, though no page shows them yet; the notes a submitter or reviewer writes for editors are kept in a separate table that is only sent to editor connections. Readers post proposals and comments through the Worker, which validates them and limits each address to 6 posts a minute.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:reset     # migrate and seed the local D1
pnpm dev
```

Sign in at `/editor` with the `EDITOR_TOKEN` from `.dev.vars`.

The news search needs the remote AI binding, which plain `pnpm dev` leaves off. Run `pnpm dev:remote` (after `wrangler login`) to use it locally; searches bill the logged-in account.

`pnpm test` runs the unit tests and `pnpm typecheck` checks all three TypeScript projects.

## Data

`seed/data/us-congress.json` holds the current roster (from [congress-legislators](https://github.com/unitedstates/congress-legislators)) and the sponsor and cosponsor records for H.R. 3069 and S. 1506 (from the Congress.gov API). `pnpm seed:fetch` refreshes it; set `CONGRESS_API_KEY` to avoid the shared rate limit.

`seed/data/us-states-era.json` holds each state's action on the Equal Rights Amendment, transcribed from the National Archives' [list of state ratification actions](https://www.archives.gov/files/foia/pdf/era-list-of-state-ratification-actions-03-24-2020.pdf) of March 24, 2020. A state that ratified and later voted to rescind is recorded as mixed, with both acts on its record.

`seed/data/us-congress-asks.json` holds the day the next Congress starts, the key offices with who holds them between which dates, and the asks put to those offices. It is written by hand, and an ask starts with nothing on its record. The roster of members-elect is not in it yet, so the next-term view shows today's members in their seats.

`seed/data/demo.json` is a fictional city council that shows challengers and every kind of footing. It is labelled as demo data wherever it appears.

Seeding writes rows directly and skips the sync log, so seed before readers are connected.

`pnpm seed:build` also writes one file per data set (`seed/out/us-congress.sql`, `us-congress-asks.sql`, `us-states.sql`, `demo.sql`). Seeding replaces rows, so to add a data set to a database editors have been working in, run only its file:

```sh
pnpm seed:build && wrangler d1 execute DB --remote --file seed/out/us-states.sql
```

## Deploy

Production deploys from git. Cloudflare Workers Builds watches the `main` branch of this repo, runs the Vite build, and deploys the Worker. Every other branch gets a [Preview](https://developers.cloudflare.com/workers/previews/) from `wrangler preview`. Migrations do not run in either build, so apply them by hand before pushing a schema change.

One-time setup, from a machine with `wrangler login`:

```sh
wrangler d1 create decidering          # put the id in wrangler.jsonc
wrangler d1 migrations apply DB --remote
pnpm seed:build && wrangler d1 execute DB --remote --file seed/out/seed.sql
wrangler secret put EDITOR_TOKEN
```

Then connect the repo in the Cloudflare dashboard and push to `main`. Secrets persist across deploys.

### Previews

A Preview takes only the bindings in the `previews` block of `wrangler.jsonc`. All Previews share one database, `decidering-preview`, so nothing posted or approved on a preview URL reaches production. Each Preview gets its own sync room.

Set the preview database up once, and migrate it again whenever the schema changes:

```sh
pnpm db:migrate:preview
pnpm db:seed:preview
wrangler preview base-config secret put EDITOR_TOKEN
```

Without the secret a Preview still runs, but nobody can sign in at `/editor`. Cron Triggers only fire in production, so the news search runs on a Preview only when an editor starts it.

The news search routes through the AI Gateway named `default` and pays from its credits, or from an Exa key stored on the gateway.

## News search

Every six hours the Worker runs a few searches for each question marked as in the news. A result becomes a lead when its title or excerpt names someone on that body's roster. Leads carry the search excerpt and no position; the editor reads the source, fixes the quote, and chooses what it shows before anything is published.
