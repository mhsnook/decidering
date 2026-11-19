# Sporelight

A tracker for open questions in front of the people who decide them. For each person and each question it shows where they stand, the statements and acts that position rests on, and how solid that footing is.

The first data set is the United States Congress and Medicare for All. Nothing in the model is specific to either.

## How it works

- **Bodies, seats, roles.** A body (a legislature, a council, a board) has seats. A role is one claim on a seat: who, between which dates, how sure, and what it still depends on. The person who holds a seat today, a member-elect, the leader in a recount and someone running for the seat are all roles, told apart only by those four things. A challenger is a possible holder from the next term, so they sit beside the incumbent they want to replace.
- **Questions, measures and asks.** A question asks where someone stands ("Do they support Medicare for All?"). A measure is a sub-question about one recordable act, put to everyone in the body or chamber ("Have they cosponsored H.R. 3069?"). An ask is a sub-question put to a key role in the body, or to a person by name ("Will they commit to a markup?", asked of the committee chair). It has its own position scale and record, the people it is put to are shown first on the question's page, and an editor closes it when it is resolved or no longer being asked.
- **Offices and terms.** An office is a key role, such as a committee chair, and it outlives its holders. Seats and offices both have dated holders, and a body can name the day its next term starts. A question's page can then be viewed as the body stands now or as it is expected to stand from that day: seats are filled by whoever holds them then, and an ask of an office is put to whoever sits in it then. Each holder keeps their own position and record on the ask.
- **Likely and possible.** A seat or office can be held certainly, likely or possibly over its dates. That is a fact about the holding, not the person: someone can be certain in the seat they have now and only possible in it after a recount. Whoever is certain or likely is shown as the holder, marked "Likely" where it is not settled. Anyone who may yet hold it is listed beside them, and a seat with only possible holders is listed as not decided.
- **Roles held at large.** An office with no body is a role someone holds in their own right, such as leading an outside organisation. It shows with them in every body they sit in, can link to the source that says they hold it, and can have asks put to it like any other office.
- **Questions put to several bodies.** A question is listed under one body and can be put to others as well. Its page is looked at through one body at a time, with that body's seats and chart. Positions and records belong to the person, so someone who sits in two of the bodies has one answer in both.
- **Sources, acts, reports and readings.** A source is an article, press release, official record, transcript or post, one row per URL. An act is one thing a person did or said. A report is a mention of an act in a source, so a statement covered by five articles is one act with five reports. A reading is what an act signals on one question, and one act can read differently on two questions.
- **Archived copies.** Every source that backs something on the record gets a copy in the Wayback Machine where one can be had, linked as "archived" beside the source wherever it is shown. A scheduled pass finds or asks for the copies (see [Archiving sources](#archiving-sources)), and an editor can ask for one or give the address of a copy kept elsewhere.
- **Says, commits, does.** An act is one of three kinds, by how much it binds the person. Saying is words in any medium. Committing is formal, public and revocable: cosponsoring, signing a letter, taking a pledge. Doing is using the office itself: voting, scheduling, ratifying. A commitment can be withdrawn on a date. Words and uses of office cannot be taken back, only answered by a later act.
- **Direct and indirect.** A reading also says how the act bears on the question. A vote on the bill itself is direct. A vote on something else that tells you about the question is indirect: it shows on the record as a signal, and does not put the person on the record there. This is how someone who says one thing and does another has both on their page.
- **What counts toward the parent.** A reading on a measure or an ask says nothing about the parent question unless the sub-question says what doing it means there (`implies_on_parent`). Cosponsoring a bill is marked as support, so a supporting reading there is also written on the parent. A letter against a policy would be marked as opposition.
- **Measures are read off the record.** On a measure nobody sets where someone stands. They have signed on if a commitment or a use of office is on file and still holds, and have not otherwise. Withdraw the commitment and they have not from that day.
- **Closing.** A question can close, and its closing date can lie ahead: a bill dies when its Congress ends. A closed measure keeps showing who had signed on when it closed. On its parent, those commitments stop counting as on the record and stay as dated history.
- **Footing.** Every position links to dated acts. Footing is derived from them: on the record (a direct use of office, or a direct commitment still in force), fresh, established, sparse, stale, or unknown. The rules live in `shared/standing.ts`.
- **Seat charts.** A question's page draws each chamber as a hemicycle, one dot per voting seat, packed so neighbours along a row sit as far apart as the rows do, ordered from support on the left to opposition on the right with the undecided in between. A line marks how many seats carry the question: a simple majority unless the question sets its own threshold, such as 38 of 50 states. It runs between the seats with exactly that many on its left, crossing each row through a gap and curving from one gap to the next, and a bloc that reaches it has the votes. A body with no chambers gets a single chart.
- **Review queue.** A proposal is a suggested set of changes from one source. Each item in it is one act by one person, read on one question, with the position and summary it would leave them with. Readers send in proposals from any person's page, and a scheduled news search has a model read each article that names people on the roster and adds one for each that records something. An editor at `/editor` accepts or rejects each item and publishes the accepted ones together. Nothing reaches the record until then. An editor can also merge two acts that turn out to be the same one.
- **Latest.** `/latest` lists what has entered the record as stories, newest first. A story is one source and everyone an editor published from it in one review: each person's act is a reply under the source, with when it happened and what it shows on each question it is read on. A source that reports an act already on file makes a new story, and the act is marked as already on the record. Replies fold after three, and a row of standing tokens in each story's header shows how it splits. The feed can be narrowed to a question and everything under it (`?question=`), or to a body (`?body=`: anyone with a seat in it, past, present or running for one, on questions put to it), which also narrows the people in each story; each question's page links to its own slice. It shows 20 stories a page, with a link to older ones. What is waiting for review sits in the same feed, by when it was put forward, as a short dashed entry per proposal: the outlet and who put it forward, the headline, and up to two claims, each with where that person stands now. Opened, it shows every claim with its words, and asks the reader to check them against the source and say what is wrong in the discussion on that person's page. Only pending items that claim a reading show. Rejected items and search leads that only name someone are left out. `?recordOnly=true` shows only the published record and loads no proposals.
- **Atom feed.** `/feed.xml` is an Atom feed of the newest 20 published stories, served by the Worker from D1, with the same `question` and `body` filters. Each entry lists the people in the story with a link to each one's page. It never carries anything waiting for review.
- **Discussion.** Each person-and-question page has a comment thread. A reader loads and hears only the threads they have open. Comments post under a username the reader picks the first time they post. Editors can remove comments.

## Stack

- Cloudflare Worker + D1, with a React SPA served as static assets
- [party-db](https://github.com/mhsnook/party-db) syncs every public table to the browser over one Durable Object room; pages are live queries over the local copy
- TanStack Router (file-based routes in `src/routes`), TanStack DB, Tailwind
- Cloudflare [Web Search API](https://developers.cloudflare.com/web-search/) with Exa, and Workers AI, through AI Gateway, for the news search and reading the articles it finds

Editors write through the same collections with optimistic transactions. Readers get read-only access. Unreviewed proposals are public. They are sliced collections, so a browser only loads them when a page queries them: the editor's queue, and `/latest` unless `?recordOnly=true` is set. The notes a submitter or reviewer writes for editors are kept in a separate table that is only sent to editor connections. Readers post proposals and comments through the Worker, which validates them and limits each address to 6 posts a minute.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:reset     # migrate and seed the local D1
pnpm dev
```

Sign in at `/editor` with the `EDITOR_TOKEN` from `.dev.vars`.

The news search needs the remote AI binding, which plain `pnpm dev` leaves off. Run `pnpm dev:remote` (after `wrangler login`) to use it locally; searches bill the logged-in account.

## Tests

```sh
pnpm typecheck     # every TypeScript project, tests included
pnpm test:unit     # pure functions, in Node
pnpm test:worker   # the Worker, in workerd
pnpm test:e2e      # the app, in Chromium
pnpm test          # unit and Worker tests together
```

`pnpm typecheck` needs a `.dev.vars` (copy `.dev.vars.example`), since that is where `wrangler types` finds `EDITOR_TOKEN`.

The Worker tests run in workerd through [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/), with the bindings in `wrangler.jsonc` and a local D1 that has every migration in `migrations/` applied. They call the Worker's `fetch` and the party endpoint the way a browser does, over HTTP and WebSockets. Each test file gets its own database and Durable Object storage, and the tests in a file share them. The news search and the article reader are tested with the AI binding and `fetch` replaced, so nothing reaches the network or a model.

The browser tests reset and seed the local database with `pnpm db:reset`, which throws away anything written to it locally, then start the dev server on port 5179 and drive it with Playwright. They use the editor token in `.dev.vars`. Install Chromium once with `pnpm exec playwright install chromium`.

CI runs all of these on every pull request and on pushes to `main` (`.github/workflows/ci.yml`). It needs no secrets and deploys nothing.

## Data

`seed/data/us-congress.json` holds the current roster (from [congress-legislators](https://github.com/unitedstates/congress-legislators)) and the sponsor and cosponsor records for H.R. 3069 and S. 1506 (from the Congress.gov API). `pnpm seed:fetch` refreshes it; set `CONGRESS_API_KEY` to avoid the shared rate limit.

`seed/data/us-states-era.json` holds each state's action on the Equal Rights Amendment, transcribed from the National Archives' [list of state ratification actions](https://www.archives.gov/files/foia/pdf/era-list-of-state-ratification-actions-03-24-2020.pdf) of March 24, 2020. A state that ratified and later voted to rescind is recorded as mixed, with both acts on its record.

`seed/data/us-congress-elect.json` holds the seats that change hands when the next Congress starts: who leaves each one and who was elected to it, taken from the winners marked on Wikipedia's pages for the 2026 House and Senate elections, which follow the Associated Press. Results are uncertified. Seats not yet decided are listed apart: whoever is ahead in a recount is seeded as the likely holder with the current holder as possible, and the candidates in a runoff are both possible. Someone elected for the first time gets an id of our own, since a Bioguide id only exists once they are sworn in.

`seed/data/us-congress-asks.json` holds the day the next Congress starts, the key offices with who holds them between which dates, and the asks put to those offices. It is written by hand, and an ask starts with nothing on its record.

`seed/data/demo.json` is a fictional city council that shows challengers and every kind of footing, with a second fictional body that shares two of its members, a question put to both, and a role held at large. It is labelled as demo data wherever it appears.

Seeding writes rows directly and skips the sync log, so seed before readers are connected.

`pnpm seed:build` also writes one file per data set (`seed/out/us-congress.sql`, `us-congress-asks.sql`, `us-states.sql`, `demo.sql`). Seeding replaces rows, so to add a data set to a database editors have been working in, run only its file:

```sh
pnpm seed:build && wrangler d1 execute DB --remote --file seed/out/us-states.sql
```

## Deploy

Production deploys from git. Cloudflare Workers Builds watches the `main` branch of this repo, runs the Vite build, and deploys the Worker. Every other branch gets a [Preview](https://developers.cloudflare.com/workers/previews/) from `wrangler preview`.

A build can apply database migrations before it deploys. In the Cloudflare dashboard, under the Worker's Settings > Builds:

- set the deploy command to `pnpm run deploy:ci`;
- set the preview command to `pnpm run preview:ci`;
- give the build's API token the D1 Edit permission. The token Cloudflare generates for builds does not include it.

Until that is done, apply migrations by hand before pushing a schema change: `pnpm db:migrate:remote` for production and `pnpm db:migrate:preview` for Previews. Seeding is never automatic.

One-time setup, from a machine with `wrangler login`:

```sh
wrangler d1 create sporelight          # put the id in wrangler.jsonc
wrangler d1 migrations apply DB --remote
pnpm seed:build && wrangler d1 execute DB --remote --file seed/out/seed.sql
wrangler secret put EDITOR_TOKEN
wrangler secret put ARCHIVE_ORG_KEY   # optional; see Archiving sources
```

Then connect the repo in the Cloudflare dashboard and push to `main`. Secrets persist across deploys.

### Previews

A Preview takes only the bindings in the `previews` block of `wrangler.jsonc`. All Previews share one database, `sporelight-preview`, so nothing posted or approved on a preview URL reaches production. Each Preview gets its own sync room.

Set the preview database up once. All Previews share it, so a migration on one branch reaches every Preview:

```sh
pnpm db:migrate:preview
pnpm db:seed:preview
wrangler preview base-config secret put EDITOR_TOKEN
```

Without the secret a Preview still runs, but nobody can sign in at `/editor`. Cron Triggers only fire in production, so the news search runs on a Preview only when an editor starts it.

The news search and the article reader route through the AI Gateway named `sporelight` (the `AI_GATEWAY` var), which has to be created in the dashboard. Searches pay from AI Gateway credits, or from an Exa key stored on that gateway.

## News search

Once a day (14:17 UTC) the Worker runs four searches for each question marked as in the news. A result is followed up when its title or excerpt names one to three people on that body's roster.

The daily run is skipped while the queue is unattended: when leads it queued earlier are still waiting and no editor has reviewed one in the last day. The next run after a review goes ahead. "Search the news now" in `/editor` always runs.

### Reading the article

For each result followed up, the Worker:

1. Fetches the page (10 second timeout, 3 MB at most) and turns it into plain text with Workers AI [Markdown Conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/) (`env.AI.toMarkdown`, text output). HTML, PDF and plain text are read; the text is cut at 60,000 characters.
2. Sends the text to `@cf/deepseek-ai/deepseek-v4.1-flash-1017` on Workers AI, with reasoning off and JSON output in a fixed schema. The model is told the question, its open sub-questions, and which of them are put to each person named, by the same rules the question pages use. It returns each act it finds: who, on which question, the kind, the words, the date, what it shows, whether it bears on the question directly, a one-line summary, and a reason for the editor.
3. Keeps an act only if its words appear in the fetched text (ignoring case, whitespace, and the style of quote marks and dashes), its person is one the article was read for, and its question is one put to that person. It keeps one act per person and question, and at most eight from one article.
4. Queues the article as one proposal from origin `model`, with one item per act, already filled in. The model's reason goes in a note on each item and the model's id in a note on the proposal; only editors receive notes.

An article the model reads and finds nothing in queues nothing. If the page cannot be fetched (many news sites turn away bots), has almost no text, or the model fails or answers out of shape, the result is queued as before: a lead with the search excerpt and no reading, with a note saying why the article was not read.

Each article is read once per question. The table `article_reads` records the URL, question, time, outcome and model, and a result already in it, or already proposed from on that question, is skipped without fetching. It is a plain table and is not synced to browsers.

The model id is `MODEL` in `worker/reader.ts`. The search and the model both go through the AI Gateway named in `AI_GATEWAY` (`wrangler.jsonc`), so their cost shows on that gateway.

### Calls per run

A run reads at most 15 articles (`MAX_READS_PER_RUN` in `worker/news.ts`); results beyond that are left for the next run, which finds them again if the search still returns them. A model call that fails (a spending limit on the gateway, a rate limit, an outage) also ends reading for the run: that result falls back to its excerpt lead and the rest wait. With two questions in the news, one run spends at most:

| Call | Count | Counts against |
| --- | --- | --- |
| Web searches | 4 per question, so 8 | Cloudflare services |
| Article fetches | 15, plus redirects | outside requests (50 a run on Workers Free) |
| Markdown conversions | 15 | Cloudflare services |
| Model calls | 15 | Cloudflare services |
| D1 queries | about 10 per result looked at | Cloudflare services |
| Archive lookups, capture requests and status checks | at most 15 (see [Archiving sources](#archiving-sources)) | outside requests |

Together the article fetches and the archiving pass make at most 30 outside requests, which leaves 20 for redirects under the Workers Free limit of 50.

A model call sends up to about 15,000 tokens of article and gets back a few hundred. At $0.30 per million input tokens and $1.20 per million output tokens that is under half a cent per article, and under 10 cents for a full run, which is once a day. Spending limits set on the gateway cap this; a run that hits one stops reading, as above. The model needs the Workers Paid plan or prepaid AI Gateway credits. It allows 20 requests a minute on standard billing, which a run of 15 reads one at a time stays under.

### Trying the reader on one page

An editor can run the reader on one URL without queueing anything: open "Try the article reader on one page" at the top of `/editor`, paste a URL and pick a question. It fetches the page, reads it for everyone on that question's roster the page names (up to eight), and shows what would be queued, what was left out and why, or why the page could not be read. The same is available as `POST /api/editor/read-article` with `{ "url": "...", "question_id": "..." }` and the editor token. On a Preview this calls the real model and bills the account.

## Archiving sources

Web pages move and disappear, so each published source (one with at least one report) that has a URL gets a copy in the Internet Archive's Wayback Machine, and its address is stored in `sources.archive_url`. It shows as an "archived" link after the source on a person's page, in `/latest`, in the Atom feed (once its five-minute cache runs out), and in the editor's review form.

### The scheduled pass

The same run that searches the news, every six hours, also takes the five oldest published sources with a URL and no archived copy that are due (`MAX_ARCHIVE_SOURCES_PER_RUN` in `worker/archive.ts`). For each one it:

1. asks the [availability API](https://archive.org/help/wayback_api.php) for the capture closest to when we recorded the source, and stores it unless it was taken more than 30 days before then (an older capture may predate what the source says);
2. otherwise, if the Worker has an archive.org key, asks [Save Page Now 2](https://docs.google.com/document/d/1Nsv52MvSjbLb2PCpHlat0gkzw0EvtSgpKHu4mk0MnrA) for a new capture and records the job.

The pass runs beside the news search, so while the news search reads articles it waits 90 seconds and then asks Save Page Now once how each of its jobs went. A finished capture is stored. A job still running is left for the next run, which looks the page up again near the time the capture was asked for. The stored address is written through the Tracker room's `commit`, like a proposal, so every open browser gets it through the sync log.

The table `archive_attempts` keeps one row per source the pass has worked on: the outcome, the time, failures in a row, when it is next due, and the Save Page Now job and error. It is a plain table and is not synced to browsers. A failed capture is tried again after 12 hours, then 24, 48, 96 and 192; after six failures in a row the pass stops trying. A page the archive says it cannot capture (not found, access denied, blocked, a login wall, an address that does not resolve) is given up on at once. A source that has no URL is never picked up, and an address already on a source, such as one an editor gave, is never replaced.

If the availability API or Save Page Now answers 429, or Save Page Now refuses the key or says the account is at its limit, the run stops archiving and nothing is counted against the source it was on. Requests to the archive are spaced three seconds apart, since the availability API answered 429 to a few requests a second apart.

### Requests per run

Each source costs at most three outside requests: a lookup, a capture request and a status check. A run therefore makes at most 15, alongside the news search's article fetches (see the news search's [calls per run](#calls-per-run)). At five sources a run and four runs a day, a backlog of published sources clears at about 20 a day. On the Workers Paid plan the cap can be raised; Save Page Now allows 7 captures a minute and 30,000 a day per account, and 5 captures of one URL a day.

### What the owner has to set up

Without a key the pass only looks for captures that already exist; a source with none is marked `no_key` and looked at again a week later, or on the first run after a key is set. To have the pass ask for captures, create an archive.org account, get an S3 key pair at <https://archive.org/account/s3.php>, and store it as one secret in the form `accesskey:secret`:

```sh
wrangler secret put ARCHIVE_ORG_KEY
```

Previews take the secret with `wrangler preview base-config secret put ARCHIVE_ORG_KEY`, though Cron Triggers never fire there, so on a Preview only an editor's request archives anything. Locally it goes in `.dev.vars`.

### By hand

Under each source on a person's page and in the review form an editor sees "Archive now", which runs the same steps for that source at once, ignoring any back-off, and waits about half a minute for the capture before leaving it to the scheduled pass. The same is `POST /api/editor/archive` with `{ "source_id": "..." }` and the editor token. An editor can also give the address of a copy kept anywhere, such as archive.today, which is saved on the source like any other edit.

### Documents with no public address

A press release that arrived only by email has no URL for the Wayback Machine to fetch, so the pass leaves it alone; such a source shows with its title and no link. `sources.stored_copy` is reserved for the address of a copy we keep ourselves, which is not built yet.
