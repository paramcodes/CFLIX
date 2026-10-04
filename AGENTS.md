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
NODE_PATH=/tmp/opencode/node_modules node scripts/capture.mjs <outdir> [baseUrl]
```

## Conventions

- Visual changes require screenshots, a video, and a "What changed" section in the PR.
- One small issue per change.
- The smoke test must pass (`npm test`).
- Keep `main` in sync with `origin/main`.
- Do not touch files outside your issue's scope.

## Workspace Architecture

- **Search & Grep**: `.ignore` and `.prettierignore` exclude `.worktrees/`, `.opencode/`, and `artifacts/` to keep search instantaneous and prevent duplicate matches across worktrees.
- **Provider Architecture**: `server/src/providers/` is the single source of truth for catalog adapters (Cinemeta, TVMaze, Kitsu, Cache Store).
- **Frontend Pages**: `public/wire.js` delegates to `public/js/pages/*.js`. Shared helpers reside in `public/js/core.js`.
- **Worktrees**: The active revamp program worktrees live in `.worktrees/p-*`. When working directly in root, ensure `git status` stays clean.

## Learned Workspace Facts

- The root checkout's git state is not trunk, and `0f6fc07` ("chore: added the dot files") is the local-only commit its `main` still points at: not an ancestor of trunk, and never will be. That commit accidentally committed 97 `.worktrees/*` gitlink entries, which made every worktree add or remove show up in `git status` and made clean nested worktrees report phantom modifications to siblings; fixed on trunk in `a26f380` (PR #32), which gitignores `.worktrees/` and `children.tsv` and empties the gitlinks from the index. The root's local `main` lags trunk and sits 1 commit ahead of it because merges land through `gh` without fast-forwarding the checkout, so `git pull --ff-only` fails there — do not force `main` back in step from the root. The trap that follows is reading the root as trunk: `git ls-files` there still lists all 97 gitlinks, `cat .gitignore` still lacks a `.worktrees/` entry, and its phantom deletions of already-removed worktrees are that same artifact, not new breakage, while `git ls-tree -r origin/main` shows 0 gitlinks and trunk's `.gitignore` ignores both. Ask trunk directly with `git show origin/main:<path>`. Nothing is stranded in `0f6fc07` — every file it added is already on trunk through a later squash — so it is safe to leave the root where it is.
- The active page-revamp program runs as one worktree and one branch per owner under `.worktrees/`: `p-nav`, `p-home`, `p-browse`, `p-detail`, `p-player` on `rev/p-nav`, `rev/p-home`, `rev/p-browse`, `rev/p-detail`, `rev/p-player`, plus `w2-integrate` and `w2-verify` on their own branches. All page-owner worktrees were branched from the same trunk commit, so a change in one does not appear in another; never edit a sibling owner's tree. The shared brief is `.worktrees/program/wave2-brief.md` and the goal with the tick log is `.worktrees/program/goal.md`.
- `.worktrees/program/` holds the program's coordination state (`goal.md`, `wave2-brief.md`, `children.tsv`, `contract.js`, `baseline.mjs`). None of it is tracked — trunk gitignores `.worktrees/`, so these files exist only on disk in the root checkout and are lost if that directory is pruned. `children.tsv` is the live registry of child tasks and their state; check it before assuming a worktree is unused.
- Neither `git worktree list` nor a dirty worktree is evidence of live work. The list reports 108 entries, and 82 of them are nested fan-out lanes from the earlier swarm phases under `.worktrees/swarm-p*/`; they sit at detached HEADs pinned to one commit per phase, all unlocked, and their work reached trunk through squashed PRs, so `merge-base --is-ancestor` reports `NO` for a lane commit that is already merged. Filter the list to named branches and top-level `.worktrees/*` entries before reading it as current state. Likewise, a worktree whose branch is not an ancestor of `origin/main` is not automatically unmerged work: `p6-parallel-fetch` and `proto-routes` both looked live (branch off trunk, dirty tree) but were superseded — their HEADs were already on trunk, and their uncommitted files were older copies of files trunk had since replaced. Check `git merge-base --is-ancestor <head> origin/main` and diff any dirty file against `origin/main` before treating a worktree as recoverable work. Both were removed on 2026-10-04 after that check; their run trail is at `/tmp/opencode/p6-trail/`.
- Work lands through real GitHub PRs: remote `https://github.com/paramcodes/CFLIX.git`, default branch `main`, `gh` authed as `paramcodes` with `repo` scope. The poteto-mode `autopilot-full` and `multi-phase-plan` playbooks assert "Origin is not installed"; that is stale on this machine, where both `gh` and `origin` are present.
- A server started as `(node server/index.js &)` inside a single shell tool call dies when that call ends; start it with the shell tool's background mode instead so it stays up for smoke tests and captures across calls.
- **Never write AGENTS.md from a source that does not already contain its `Learned Workspace Facts` section.** A subagent's memory-updater flow rebuilt this file on 2026-10-04 11:19 from a version that predated the section and appended one bullet, destroying every fact above; nothing was committed, so git held no copy and no other file on disk had them. Facts added here must be committed in the same change that adds them, or they are one overwriting write away from being unrecoverable.
- API probing traps: `profileId` must travel in the `x-cflix-profile` header, never as `?profileId=` — the query param silently yields `{"error":{"code":"NOT_FOUND","message":"no such profile"}}`. Browse is `GET /api/catalog/browse?kind=&genre=` and the handler reads exactly those two params, so there is no `skip`/`limit`/`cursor` to send and the reply is `{items}` with no cursor: browse rails cannot page. Only `POST /api/catalog/search` returns `nextCursor`, and that cursor is an offset string (`String(from + size)`, parsed back with `parseInt`), not an opaque token.
- `artifacts/` must stay committable: 70 files under it are already tracked and the conventions require screenshots in PRs, so `.gitignore` must never list `artifacts/` — such an entry was added once and would have silently blocked page owners from committing their evidence. `.ignore` (ripgrep) and `.prettierignore` may still list it; that is fine.
- Provider routing: `KIND_PROVIDER = { anime: 'kitsu' }` is consulted on both paths now — `providerBrowseItems` and `providerSearchItems` each resolve `KIND_PROVIDER[kind] ?? providerName()`. Until PR #47 only search consulted it, so `browse?kind=anime` answered with 24 Cinemeta movie/series items while the search box returned Kitsu. If anime ever stops returning anime, look at that expression first. Switching adapters mid-call is safe: `cacheKey(name, op, ...)` carries the provider name so entries cannot collide, both adapters accept `{kind, genre, limit}`, and `throughCache` refuses to cache an empty array so a cold-start miss self-heals instead of storing the fallback.
- Search ships twice, deliberately: `home.html` renders matches inline in `#row-results-wrap` — a rail with tail-loading and a "Browse all results" link — while `/browse` renders a URL-driven grid with kind/genre filters. Both call `POST /api/catalog/search`; only home's is inline, and home is the only page with a `#search-form` (the nav has no search field). Change one and check the other: `scripts/home-check.mjs` and `scripts/verify/verify-browse.mjs` both assert the home path.
- Detail and play data-contract traps, measured against the running app: `GET /api/catalog/get` returns a populated `episodes[]` only on the Cinemeta path — TVMaze and Kitsu both return `episodes: []` from `get()` even though the Kitsu adapter implements `episodes()`, so a Kitsu series page has no episode list and must handle the empty case explicitly. `/api/play` with `{kind:'episode', id:'<cinemeta id>'}` returns 404 NOT_FOUND because `catalog.js`'s `EPISODE_ID = /:e\d+$/` matches the seed fixture's `s1e1` style but not the `tt1844624:1:3` form Cinemeta emits, leaving `playProvider`'s owner lookup nothing to resolve; seed episode refs work, provider episode refs do not. The offline fixture also carries a duplicate episode id: `s2e1` is both Dark season 2 episode 1 "Knots" and another series' season 1 episode 1 "Pilot", and `findSeedEpisode` returns the first match, so such a ref is ambiguous.
- Logo and backdrop images are usually real, not null: `https://images.metahub.space/logo/medium/<imdbId>/img` returned HTTP 200 with a real generated wordmark PNG for 47 of 48 sampled titles and 404'd once, so `logoUrl` is almost always a working image rather than null the vast majority of the time as `.worktrees/program/wave2-brief.md` states — keep the styled-text fallback and the image error path, but the wordmark is the common case. To layer a photo over a gradient fallback on a single element, use two background layers through a custom property rather than a child element: an opaque child `.ph` gradient paints over its parent's `background-image`. A failed `<img>` still paints its broken-image glyph over whatever sits behind it even with an empty `alt`, so the element has to be removed, not visually covered.
- Check-writing traps: Playwright treats `aria-disabled="true"` as disabled for actionability, so clicking such a button needs `{force: true}` — `signin.html`, `home.html` and `profiles.html` each ship one. `public/watch.html`'s `.player__title` is empty markup since #45 dropped the placeholder, so wait for `cflix_play_ref` to clear (the player consumed the ref) before asserting on the title. Media assertions in `scripts/player-check.mjs` and `.player__elapsed advances while playing` in `wiresplit-check.mjs` need YouTube reachable; one run in three saw `iframes=0`, so re-run a media-only failure before believing it.
