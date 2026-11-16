# Decidering

A tracker for open questions in front of the people who decide them. For each person and each question it shows where they stand, the statements and acts that position rests on, and how solid that footing is.

The first data set is the United States Congress and Medicare for All. Nothing in the model is specific to either.

## How it works

- **Bodies, seats, roles.** A body (a legislature, a council, a board) has seats. A person holds a seat or is running for it, so challengers sit beside the incumbent they want to replace.
- **Questions and measures.** A question asks where someone stands ("Do they support Medicare for All?"). A measure is a sub-question about one recordable act ("Have they cosponsored H.R. 3069?"). Evidence on a measure also counts toward its parent question.
- **Evidence and footing.** Every position links to dated evidence. Footing is derived from it: on the record (a vote or formal act), fresh, established, sparse, stale, or unknown. The rules live in `shared/standing.ts`.
- **Seat charts.** A question's page draws each chamber as a hemicycle, one dot per voting seat, packed so neighbours along a row sit as far apart as the rows do, ordered from support on the left to opposition on the right with the undecided in between. A line marks how many seats carry the question: a simple majority unless the question sets its own threshold, such as 38 of 50 states. It runs between the seats with exactly that many on its left, crossing each row through a gap and curving from one gap to the next, and a bloc that reaches it has the votes. A body with no chambers gets a single chart.
- **Review queue.** Readers send in evidence from any person's page. A scheduled news search adds leads for questions marked as in the news. Nothing is published until an editor approves it at `/editor`.
- **Discussion.** Each person-and-question page has a comment thread. A reader loads and hears only the threads they have open. Comments post under a username the reader picks the first time they post. Editors can remove comments.

## Stack

- Cloudflare Worker + D1, with a React SPA served as static assets
- [party-db](https://github.com/mhsnook/party-db) syncs every public table to the browser over one Durable Object room; pages are live queries over the local copy
- TanStack Router (file-based routes in `src/routes`), TanStack DB, Tailwind
- Cloudflare [Web Search API](https://developers.cloudflare.com/web-search/) with Exa, through AI Gateway, for the news search

Editors write through the same collections with optimistic transactions. Readers get read-only access, and unreviewed submissions are only sent to editor connections. Readers post submissions and comments through the Worker, which validates them and limits each address to 6 posts a minute.

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

`seed/data/demo.json` is a fictional city council that shows challengers and every kind of footing. It is labelled as demo data wherever it appears.

Seeding writes rows directly and skips the sync log, so seed before readers are connected.

## Deploy

Production deploys from git. Cloudflare Workers Builds watches the `main` branch of this repo, runs the Vite build, and deploys the Worker. Migrations do not run in that build, so apply them by hand before pushing a schema change.

One-time setup, from a machine with `wrangler login`:

```sh
wrangler d1 create decidering          # put the id in wrangler.jsonc
wrangler d1 migrations apply DB --remote
pnpm seed:build && wrangler d1 execute DB --remote --file seed/out/seed.sql
wrangler secret put EDITOR_TOKEN
```

Then connect the repo in the Cloudflare dashboard and push to `main`. Secrets persist across deploys.

The news search routes through the AI Gateway named `default` and pays from its credits, or from an Exa key stored on the gateway.

## News search

Every six hours the Worker runs a few searches for each question marked as in the news. A result becomes a lead when its title or excerpt names someone on that body's roster. Leads carry the search excerpt and no position; the editor reads the source, fixes the quote, and chooses what it shows before anything is published.
