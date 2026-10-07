## Repo layout

- `server/index.js` — Node static server and JSON API entrypoint.
- `server/src/` — server-side modules (`store.js`, `services.js`, `catalog-data.js`, `types.js`, plus `auth.js`, `catalog.js`, `errors.js`, `profiles.js`) and `server/src/providers/` (the Cinemeta, TVMaze, and Kitsu adapters alongside `cache.js`, `maturity.js`, `contract.js`).
- `public/` — static assets. Pages live at the root (`index.html`, `profiles.html`, `home.html`, `title.html`, `watch.html`, `browse.html`) plus `public/(auth)/signin.html`, served through clean URLs via `PAGE_MAP` in `server/index.js` (`/`, `/signin`, `/profiles`, `/home`, `/title`, `/watch`, `/browse`).
- `public/wire.js` — page loader: it maps `document.body.dataset.page` to exactly one module under `public/js/pages/` (`signin.js`, `profiles.js`, `home.js`, `detail.js`, `player.js`, `browse.js`). Shared helpers live in `public/js/core.js`, shared tokens in `public/tokens.css`, shared component classes in `public/base.css`.
- `scripts/smoke.mjs` — smoke test against a running server.
- `scripts/capture.mjs` — Playwright capture of screenshots and a tour video.
- `scripts/*-check.mjs` — one check per adapter and per subsystem. Run the matching one when you touch
  that adapter. `git ls-files 'scripts/*-check.mjs'` lists them all and every one has a matching
  npm key, but `npm test` chains only a few, so check which before assuming a gate covered
  your change.
- `docs/revamp/` — before/after media.
- `design.md` — domain model, API envelopes, and client architecture as they ship. `server/src/providers/contract.js` remains the source of truth for catalog items, where every optional field is `string | null` or `number | null`, never a partial object, and `maturity` is always derived server-side.
- `.opencode/skills/verify-cflix/` — project-local verification skill (`SKILL.md` plus `features/`) that drives the 7 HTML pages and the JSON API. It resolves only when the session's working directory is inside the repo; started from `~` the skill stays invisible to discovery until the session moves to the repo root.

## Run tests

```sh
npm test                # Hermetic: AGENTS.md citation checks, then smoke, routing, maturity, and fixture conformance. `npm test | grep -c '^PASS'` counts only lines that begin `PASS`, which excludes the fixture stage's `fixture-conformance  PASS, …` line and the per-stage summaries.
npm run test:paths      # AGENTS.md path citations only, no server
npm run test:symbols    # AGENTS.md symbol citations only, no server
npm run check:player    # One subsystem check on its own; every check script has a matching key
npm run test:maturity   # Episode maturity guard on its own
npm run test:fixture    # Offline fixture against contract.js: every declared key, every id namespaced `seed:`, no duplicate id
npm run verify          # Full automated Playwright browser verification across all features
npm run verify:<feature> # Targeted browser verification (auth, profiles, browse, playback)
npm run timing          # Gate, API, and page-load timings; writes artifacts/timings/
npm run lint            # ESLint static analysis (catches missing imports, undeclared variables, async bugs)
npm run lint:fix        # Auto-fix lint issues
npm run format:check    # Check prettier formatting across repository
npm run format          # Auto-format with prettier
```

`node -e "console.log(Object.keys(require('./package.json').scripts).join('\n'))"` is the command that
lists every gate; `git ls-files 'scripts/*-check.mjs'` lists the scripts they front.

The test runner handles port allocation and server teardown automatically. You can run `npm test` repeatedly without port collisions or `EMAIL_TAKEN` failures.

If you have a manual server instance running, you can run smoke tests against it directly:
```sh
PORT=3000 npm run test:smoke
```

## Run the server manually

```sh
npm start  # default port 3000; override with PORT
```

## Capture media

```sh
node scripts/capture.mjs <outdir> [baseUrl]
```

## Workspace Architecture

- **Provider Architecture**: `server/src/providers/` is the single source of truth for catalog adapters (Cinemeta, TVMaze, Kitsu, Cache Store).
- **Frontend Pages**: `public/wire.js` delegates to `public/js/pages/*.js` — exactly one module per `data-page`, and `watch.html` loads only `wire.js`, so no `nav.js` runs there: `/watch` carries one global key listener, a `document` keydown in `player.js` that PR #53 added for `F`, `Space`, and `M`; the page still ships exactly one `<script>`, so nothing else competes with it. Shared helpers reside in `public/js/core.js`. The seek-bar anchor and the player's overflow pair moved in PR #53, so read `git show origin/main:public/base.css` rather than trusting a remembered line number.


## Learned Workspace Facts

Each rule below names a command that answers it, a check that enforces it, or a distinctive symbol
you can grep for. Only the first two are machine-enforced: `npm run test:paths` and
`npm run test:symbols` read this file, and nothing here reads the rules they cannot check, such as
the no-line-number rule or one-writer-per-tree. Treat those as advice, not gates.

### What the gates enforce and what is advice

- Two checks read this file, and both run first in `npm test` before a server boots.
  `scripts/agents-paths-check.mjs` (`npm run test:paths`) fails when a cited path resolves to no
  tracked file, resolving against `git ls-files` rather than the working tree so the verdict is
  identical in a fresh clone and in a sibling worktree. A citation swallowed by an ignore rule
  reports as `gitignored`, which is the more serious failure: a typo is a wrong sentence, but a
  gitignored probe is a conclusion whose only evidence no longer exists. On 2026-10-05 it reported
  19 failures, 9 of them the gitignored design probes under the worktrees directory.
  `scripts/agents-symbols-check.mjs` (`npm run test:symbols`) fails when a bullet names a source
  file and a symbol that file no longer contains, which is the drift a path check cannot see.
- **Cite a symbol or a command, never a line number.** A path resolves until it is deleted, but a
  line number is wrong the moment anything above it changes. Name the symbol, and let
  `scripts/agents-symbols-check.mjs` catch the rename. This rule is not machine-enforced: adding
  `public/base.css:667` to any bullet passes both checks (measured 2026-10-05).
- PRs #55, #56 and #57 each existed only to correct a citation in this file, and #48, #51, #52 and
  #54 restated facts about it. That is the defect class these two checks close, and it is why the
  next change to a rule should arrive with the check that enforces it (measured 2026-10-06,
  `git log --oneline origin/main -- AGENTS.md` lists them).

### Trunk is the authority, never the local checkout

- Ask trunk, not the working tree: `git show origin/main:<path>`. A local `main` can lag or lead
  after a `git reset --hard`, so a claim about "what the repo has" read from the checkout is not
  evidence. The local-only `0f6fc07`, a sibling of `a26f380`, committed 97 worktree gitlink
  entries, `git merge-base --is-ancestor 0f6fc07 origin/main` exits 1, and
  `git log --raw origin/main | grep -c 160000` returns 0, so nothing on trunk ever carried a
  gitlink, and `a26f380` (PR #32) is the commit that added the worktrees directory and
  `children.tsv` to `.gitignore` (its `.gitignore` change is exactly those two added lines with no
  deletions; the commit as a whole changed 7 files with 212 insertions, measured 2026-10-06).
- Decide "landed?" with the forge, never with ancestry: `gh pr view <n> --json state,mergedAt`.
  Work lands as squash merges, so `git merge-base --is-ancestor <head> origin/main` reports `NO`
  for a commit that already shipped, and a branch that reads merged can still hold content trunk
  lacks (measured: `rev/p-player` read MERGED and held three real player fixes that reached trunk
  only as PR #50). A repo-wide PR count goes stale the moment the next PR opens, so ask about the
  one PR you care about.
- `gh` is the only forge CLI here; the `origin` binary is not installed (measured 2026-10-05:
  `type -a origin` finds nothing). The git remote is named `origin`, which is the likeliest source
  of that earlier misread.

### Reading and writing this file

- Read the current on-disk `AGENTS.md` in full before rewriting it, and prove the rewrite against
  `git show origin/main:AGENTS.md`. A memory-updater subagent rebuilt this file on 2026-10-04
  from a version predating this section and destroyed every bullet in it; nothing was committed, so
  git held no copy. Facts added here must land in the same change that adds them.
- Never cite a path that a fresh clone will not have. The worktrees directory is gitignored, so
  anything under it is scratch that dies with the machine, and a rule leaning on it is a rule
  resting on evidence nobody else can open. `scripts/agents-paths-check.mjs` is the enforcer.
- Verify a subagent wrote the file it claimed, rather than trusting a completed status. 3 of 5
  parallel designer spawns once completed with no file written anywhere and no text response, on
  both long and short prompts and with relative and absolute output paths. The enforcer is a bare
  `test -f <path>` before you read the file, not the subagent's own word.

### Probing the API

- `profileId` travels in the `x-cflix-profile` header, never as `?profileId=`; the query param
  yields `{"error":{"code":"NOT_FOUND","message":"no such profile"}}` (read-from-code:
  `server/index.js` reads that header and no query parameter).
- Browse is `GET /api/catalog/browse?kind=&genre=` and returns `{items}` with no cursor, so browse
  rails cannot page. Only `POST /api/catalog/search` returns `nextCursor`, and it is a decimal
  offset string rather than an opaque token (read-from-code).
- `GET /api/catalog/get` fills `episodes[]` for a Cinemeta or TVMaze series but returns
  `episodes: []` for a Kitsu series, so a Kitsu series page has no episode list and must handle the
  empty case explicitly (measured 2026-10-06, five series ids each: Cinemeta 8/8/20/16/145,
  TVMaze 26/19/46/5/12, Kitsu 0/0/0/0/0).
- Each adapter declares the episode-ref shape it mints, and `episodeOwnerId` in
  `server/src/catalog.js` asks the adapters rather than holding one alternation.
  `server/src/providers/cinemeta.js` matches `:\d+:\d+$` (`tt1844624:1:3`) and
  `server/src/providers/kitsu.js` matches `:e\d+$` (`kitsu:9001:e55501`), while
  `server/src/providers/tvmaze.js` claims none because no TVmaze id separates an episode from a
  show. Fixture episode ids carry the `seed:` namespace and derive from their own coordinates,
  `seed:s1:1:1` being series `seed:s1` season 1 episode 1, and both `resolveItem` and `play` in
  `server/src/catalog.js` match them by identity through `findSeed` before consulting any
  grammar, so a fixture seed id never reaches an adapter's episode grammar (read-from-code). A claim that a seed
  episode rides the Kitsu branch is wrong; PR #39 shipped that bug, when one alternation in
  `catalog.js` carried only the Kitsu form and every Cinemeta episode resolved to itself and hit
  `MATURITY_BLOCKED`.
- Copy `scripts/player-check.mjs` for authenticated probing: `POST /api/auth/signup` yields
  `data.session.token`, `POST /api/profiles` under `authorization: Bearer <token>` creates a
  profile, and every later call sends both that header and `x-cflix-profile`. In a browser context
  set `sessionStorage.cflix_token` and `cflix_profile` in an `addInitScript` before navigating.
- Start a server with the shell tool's background mode. `(node server/index.js &)` inside a single
  tool call dies when that call ends.

### Repository invariants

- `artifacts/` must stay committable, because the conventions require screenshots in PRs and some
  are already tracked. `git ls-files artifacts | wc -l` is the command that answers how many, and
  `git check-ignore artifacts/` answers whether something hides it; `.gitignore` must never list
  `artifacts/`, while `.ignore` and `.prettierignore` may. Do not write a count into this file: it
  goes stale the moment a landing PR adds an artifact, which is why a written total was removed
  here before and again now.
- `providerForKind` in `server/src/catalog.js` is the one place a kind becomes a provider, so both
  the browse and the search path route through it and a second list path cannot route around the
  table. `KIND_PROVIDER` is the table it reads (read-from-code). Until PR #47 only search consulted
  that table, so `browse?kind=anime` answered with Cinemeta items while the search box returned
  Kitsu. If anime ever stops returning anime, `providerForKind` is the single place to look.
  `providerForKind` returns `null` under `PROVIDER=off`, which now forces the fixture even for
  `kind=anime`; it did not before PR #58, because the old table lookup ran ahead of the flag
  (read-from-code). That combination is covered: `scripts/provider-routing-check.mjs` boots a server
  under `PROVIDER=off` and browses `?kind=anime`, asserting every item is sourced `seed`
  (read-from-code, and it is stage 4 of `npm test`). The offline assertions in
  `scripts/integration-check.mjs` browse with no `kind`, so they do not cover it
  (read-from-code).
- `server/src/providers/contract.js` is the source of truth for catalog items: every optional
  field is `string | null` or `number | null`, never a partial object, and `maturity` is always
  derived server-side. `design.md` documents the catalog against that contract.
- Search ships twice on purpose. `home.html` renders matches inline in `#row-results-wrap` as a
  rail with tail-loading, and the browse page renders a URL-driven grid; both call the same
  endpoint, and home is the only page carrying a `#search-form`. Change one and check the other
  with `scripts/home-check.mjs` and `scripts/verify/verify-browse.mjs`.
- `logoUrl` is usually a working wordmark PNG rather than `null`, so keep the styled-text fallback
  and the image error path while expecting the image to load (measured 2026-10-04: 47 of 48
  sampled titles returned HTTP 200 from the metahub logo endpoint). A failed `img` still paints
  its broken-image glyph over whatever sits behind it, so remove the element rather than covering
  it.
- Worktrees branched from one trunk commit cannot see each other's edits, so never edit a sibling
  owner's tree. One writer per tree, always.

### What the gates do not cover

- `npm test` runs the path check and `scripts/smoke.mjs` over HTTP with no browser. The player and
  detail conclusions below come from `scripts/player-check.mjs`, `scripts/wiresplit-check.mjs`,
  and `scripts/verify/verify-playback.mjs`, none of which `npm test` executes, so read the CSS
  before believing a player failure is new.
- `.player` in `public/base.css` carries `overflow: hidden` then `overflow: clip` on the lines
  below it, and `clip` is not a scroll container, so focusing the seek input cannot move the box.
  The seek bar sits at the bottom of the frame via `top: auto; bottom: 0`.
- Every media control is disabled until the YouTube `onReady` callback fires, so a probe that runs
  before readiness reads as broken controls. Sound-on autoplay is not blocked in this environment;
  the embed object is simply absent for the first several seconds, and sampling inside that window
  reads as a policy block.
- A media-only assertion failure is not evidence of a regression. Untouched `main` reproduced the
  same "iframe present, controls enabled, clock frozen" signature on 4 of 8 runs (measured
  2026-10-04), so re-run against `main` before attributing it to a change.
