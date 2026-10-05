# AGENTS.md

## Repo layout

- `server/index.js` — Node static server and JSON API entrypoint.
- `server/src/` — server-side modules (`store.js`, `services.js`, `catalog-data.js`, `types.js`, plus `auth.js`, `catalog.js`, `errors.js`, `profiles.js`) and `server/src/providers/` (the Cinemeta, TVMaze, and Kitsu adapters alongside `cache.js`, `maturity.js`, `contract.js`).
- `public/` — static assets. Pages live at the root (`index.html`, `profiles.html`, `home.html`, `title.html`, `watch.html`) plus `public/(auth)/signin.html`, served through clean URLs via `PAGE_MAP` in `server/index.js` (`/`, `/signin`, `/profiles`, `/home`, `/title`, `/watch`).
- `public/wire.js` — page loader: it maps `document.body.dataset.page` to exactly one module under `public/js/pages/` (`signin.js`, `profiles.js`, `home.js`, `detail.js`, `player.js`). Shared helpers live in `public/js/core.js`, shared tokens in `public/tokens.css`, shared component classes in `public/base.css`.
- `scripts/smoke.mjs` — smoke test against a running server.
- `scripts/capture.mjs` — Playwright capture of screenshots and a tour video.
- `scripts/*-check.mjs` — a check per adapter and per subsystem (`cinemeta-check.mjs`, `tvmaze-check.mjs`, `kitsu-check.mjs`, `cache-check.mjs`, `integration-check.mjs`, `wiresplit-check.mjs`). Run the matching one when you touch that adapter.
- `docs/revamp/` — before/after media.
- `design.md` — domain model and types, but stale for the catalog: it still types `posterUrl` as a non-null `string` and predates the provider adapters entirely. `server/src/providers/contract.js` is the source of truth for catalog items, where every optional field is `string | null`, never a partial object, and `maturity` is always derived server-side.
- `.opencode/skills/verify-cflix/` — project-local verification skill (`SKILL.md` plus `features/`) that drives the 16 screens and the JSON API. It resolves only when the session's working directory is inside the repo; started from `~` the skill stays invisible to discovery until the session moves to the repo root.

## Run tests

```sh
npm test                # Automatic hermetic smoke test (finds free port, boots server, asserts 26 checks, tears down)
npm run verify          # Full automated Playwright browser verification across all features
npm run verify:<feature> # Targeted browser verification (auth, profiles, browse, playback)
npm run lint            # ESLint static analysis (catches missing imports, undeclared variables, async bugs)
npm run lint:fix        # Auto-fix lint issues
npm run format:check    # Check prettier formatting across repository
npm run format          # Auto-format with prettier
```

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

## Conventions

- Visual changes require screenshots, a video, and a "What changed" section in the PR.
- One small issue per change.
- The smoke test must pass (`npm test`).
- Keep `main` in sync with `origin/main`.
- Do not touch files outside your issue's scope.

## Workspace Architecture

- **Search & Grep**: `.ignore` and `.prettierignore` exclude the worktrees directory, `.opencode/`,
  and `artifacts/` to keep search instantaneous and prevent duplicate matches across worktrees.
- **Provider Architecture**: `server/src/providers/` is the single source of truth for catalog adapters (Cinemeta, TVMaze, Kitsu, Cache Store).
- **Frontend Pages**: `public/wire.js` delegates to `public/js/pages/*.js` — exactly one module per `data-page`, and `watch.html` loads only `wire.js`, so no `nav.js` runs there: `/watch` carries one global key listener, a `document` keydown in `player.js` that PR #53 added for `F`, `Space`, and `M`; the page still ships exactly one `<script>`, so nothing else competes with it. Shared helpers reside in `public/js/core.js`. The seek-bar anchor and the player's overflow pair moved in PR #53, so read `git show origin/main:public/base.css` rather than trusting a remembered line number.
- **Worktrees**: worktrees live under the directory `.gitignore` excludes, and each needs its
  `node_modules` symlinked to the root's because worktrees get no copy of their own. Treat any
  unregistered directory there as scratch rather than work. `git worktree list` is the command that
  answers what is real, and nothing under that directory may be cited as evidence, because a fresh
  clone does not have it.

## Learned Workspace Facts

Each rule below names the command that answers it or the check that enforces it. A rule with no
enforcer is a rule that has already failed, so this section does not carry one.

### Every rule here has a gate

- `scripts/agents-paths-check.mjs` runs first in `npm test` and in `npm run test:paths`. It fails
  when `AGENTS.md` cites a path that resolves to no tracked file, and it resolves against
  `git ls-files`, never the working tree, so the verdict is identical in a fresh clone and in a
  sibling worktree. A citation swallowed by an ignore rule reports as `gitignored`, which is the
  more serious failure: a typo is a wrong sentence, but a gitignored probe is a conclusion whose
  only evidence no longer exists. On 2026-10-05 it reported 19 failures, 9 of them the
  gitignored design probes under the worktrees directory, which is why this section no longer cites
  them.
  Every rule that follows survives only while this check is green.
- Eight of the 47 PRs merged through 2026-10-05 existed only to maintain this file, and each one
  was a restatement of a fact no gate read. That is the defect class this check closes, and the
  count is why the next change to a rule should arrive with the check that enforces it.

### Trunk is the authority, never the local checkout

- Ask trunk, not the working tree: `git show origin/main:<path>`. A local `main` can lag or lead
  after a `git reset --hard`, so a claim about "what the repo has" read from the checkout is not
  evidence (measured 2026-10-05: a `git reset --hard` moved the root checkout to `f28e281` while
  trunk was at `e28cb4f`, and the local-only commit `0f6fc07` will never become an ancestor of
  trunk because it committed 97 gitlink entries that `a26f380` removed).
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

### Probing the API

- `profileId` travels in the `x-cflix-profile` header, never as `?profileId=`; the query param
  yields `{"error":{"code":"NOT_FOUND","message":"no such profile"}}` (read-from-code:
  `server/index.js:121` reads the header and nothing else).
- Browse is `GET /api/catalog/browse?kind=&genre=` and returns `{items}` with no cursor, so browse
  rails cannot page. Only `POST /api/catalog/search` returns `nextCursor`, and it is a decimal
  offset string rather than an opaque token (read-from-code).
- `GET /api/catalog/get` returns a populated `episodes[]` only on the Cinemeta path; TVMaze and
  Kitsu both return `episodes: []` from `get()`, so a Kitsu series page has no episode list and
  must handle the empty case explicitly (measured against the running app).
- `EPISODE_ID = /:e\d+$|:\d+:\d+$/` at `server/src/catalog.js:29` serves three id shapes. The
  `:e\d+$` branch matches the Kitsu form (`kitsu:9001:e55501`) and `:\d+:\d+$` matches Cinemeta
  (`tt1844624:1:3`). Seed ids like `s1e1` match neither branch and resolve by identity through
  `findSeed` at line 227 before this grammar is consulted, so a claim that `s1e1` rides the
  `:e\d+$` branch is wrong (measured 2026-10-05 with a node one-liner over both patterns).
- Copy `scripts/player-check.mjs` for authenticated probing: `POST /api/auth/signup` yields
  `data.session.token`, `POST /api/profiles` under `authorization: Bearer <token>` creates a
  profile, and every later call sends both that header and `x-cflix-profile`. In a browser context
  set `sessionStorage.cflix_token` and `cflix_profile` in an `addInitScript` before navigating.
- Start a server with the shell tool's background mode. `(node server/index.js &)` inside a single
  tool call dies when that call ends.

### Repository invariants

- `artifacts/` must stay committable, because the conventions require screenshots in PRs and some
  are already tracked. `git check-ignore artifacts/` and `git ls-files artifacts | wc -l` are the
  commands that answer it; `.gitignore` must never list `artifacts/`, while `.ignore` and
  `.prettierignore` may (measured 2026-10-05: `git ls-files artifacts` returns 192 tracked files
  and `grep -c '^artifacts' .gitignore` returns 0).
- `KIND_PROVIDER` at `server/src/catalog.js:18` is consulted on both the browse and the search
  path, at lines 166 and 192 (read-from-code). Until PR #47 only search consulted it, so
  `browse?kind=anime` answered with Cinemeta items while the search box returned Kitsu. If anime
  stops returning anime, that expression is the first place to look.
- `server/src/providers/contract.js` is the source of truth for catalog items: every optional
  field is `string | null`, never a partial object, and `maturity` is always derived server-side.
  `design.md` is stale for the catalog, still typing `posterUrl` as a non-null `string` at lines
  70, 83, and 95.
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
  The seek bar sits at the bottom of the frame via `top: auto; bottom: 0`. Reading a player
  geometry failure as broken layout is a known misread, because the scroll-into-view moves the
  stage rather than the player.
- Every media control is disabled until the YouTube `onReady` callback fires, so a probe that runs
  before readiness reads as broken controls. Sound-on autoplay is not blocked in this environment;
  the embed object is simply absent for the first several seconds, and sampling inside that window
  reads as a policy block.
- A media-only assertion failure is not evidence of a regression. Untouched `main` reproduced the
  same "iframe present, controls enabled, clock frozen" signature on 4 of 8 runs (measured
  2026-10-04), so re-run against `main` before attributing it to a change.
