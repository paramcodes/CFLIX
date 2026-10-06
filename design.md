# CFLIX Design

CFLIX is a streaming-service prototype: a Node HTTP server that serves static pages and a JSON
API, three catalog adapters behind one contract, and a browser client built from plain ES modules
with no build step.

This file documents the system as it ships. `server/src/providers/contract.js` is the source of
truth for catalog shapes; every status code and envelope below was captured against a running
server on 2026-10-06.

## Stack

- **Server**: Node with no framework. `server/index.js` is the entrypoint: a static file server
  plus one route table.
- **State**: in-memory `Map`s in `server/src/store.js`. Nothing persists them; a restart clears
  accounts, profiles, sessions, and progress. The provider cache is a separate concern:
  `server/src/providers/cache.js` writes JSON files under `/tmp/opencode/cflix-cache`
  (`CFLIX_CACHE_DIR` overrides, `CFLIX_CACHE_TTL_MS` the TTL).
- **Client**: vanilla ES modules. `public/wire.js` loads one module per page. Shared helpers in
  `public/js/core.js`. No bundler, no transpiler.
- **Tests**: Node scripts for API and subsystem checks, Playwright for browser verification.

## Domain model

### Catalog item

`server/src/providers/contract.js` defines one `CatalogItem` shape that every adapter must
return. Optional upstream data is `null`, never a partial object.

| Field             | Type                        | Notes                                  |
| ----------------- | --------------------------- | -------------------------------------- |
| `kind`            | `'movie' \| 'series'`       |                                        |
| `id`              | `string`                    | Provider-native and stable             |
| `title`           | `string`                    |                                        |
| `synopsis`        | `string`                    | Plain text, HTML stripped              |
| `posterUrl`       | `string \| null`            | Portrait 2:3                           |
| `backdropUrl`     | `string \| null`            | Landscape 16:9                         |
| `logoUrl`         | `string \| null`            | Title treatment; falls back to text    |
| `year`            | `number \| null`            |                                        |
| `durationSeconds` | `number \| null`            | Movies and episodes, not a series      |
| `maturity`        | `'child' \| 'teen' \| 'adult'` | Derived server-side, never raw upstream |
| `genres`          | `string[]`                  |                                        |
| `cast`            | `string[]`                  | Billing order, may be empty            |
| `rating`          | `number \| null`            | Normalized 0–10                        |
| `trailerYtId`     | `string \| null`            | The only legal video source            |
| `provider`        | `string`                    | `cinemeta`, `tvmaze`, `kitsu`, `seed`  |

Series add `seasonCount` and `episodes[]`. The catalog service adds one field on the way out:
`source`, either `provider` or `seed`, which says whether the item came from a live adapter or the
offline fixture. `provider` names the adapter itself.

Episodes follow a separate `Episode` typedef: `id`, `seriesId`, `seasonNumber`, `episodeNumber`,
`title`, `durationSeconds`, `synopsis`, `stillUrl`. An episode carries no maturity of its own and
inherits the series rating.

### Profile and session

A profile is `{ id, accountId, name, maturity }`, where `maturity` is one of `child`, `teen`,
`adult` and defaults to `adult`. An account holds at most five profiles.

A session is a token with an expiry. The browser keeps both session and active profile in
`sessionStorage` under `cflix_token` and `cflix_profile`.

### Progress

`{ profileId, itemId, seconds, updatedAt }`, keyed by `profileId:itemId`. It feeds the
continue-watching row and the resume point handed back by `play`.

## Server

### Routes

`server/index.js` matches on the exact string `` `${method} ${pathname}` ``. There is no prefix
matching and no path-parameter routing, so `/api/profiles/:id` does not exist.

| Method | Path                    | Notes                                    |
| ------ | ----------------------- | ---------------------------------------- |
| POST   | `/api/auth/signup`      | Returns `{ user, session }`              |
| POST   | `/api/auth/signin`      | Returns `{ user, session }`              |
| POST   | `/api/auth/google`      | Verifies a Google credential             |
| POST   | `/api/auth/signout`     | Returns `{ ok: true }`                   |
| GET    | `/api/profiles`         | Returns `{ items: [...] }`               |
| POST   | `/api/profiles`         | Returns the created profile              |
| GET    | `/api/catalog/browse`   | `?kind=&genre=`, returns `{ items }`     |
| GET    | `/api/catalog/get`      | `?id=`                                   |
| GET    | `/api/catalog/related`  | `?id=`, returns `{ items }`              |
| POST   | `/api/catalog/search`   | Returns `{ items, nextCursor }`          |
| POST   | `/api/play`             | Body `{ ref: { kind, id } }`             |
| POST   | `/api/progress`         | Upserts one progress row                 |
| GET    | `/api/history`          | Returns `{ items }`, newest first        |

Any other path falls through to the static server: a mapped page, a file under `public/`, or a
404. There is no `/api/health`, no `/api/genres`, and no `GET /api/progress/:id`.

`PAGE_MAP` turns seven clean URLs into files: `/`, `/signin`, `/profiles`, `/home`, `/title`,
`/watch`, `/browse`.

### Envelopes

Success payloads are bare objects. Errors are always `{ "error": { "code", "message" } }`.

Status codes come from one three-way branch in `server/index.js`: `UNAUTHORIZED` and
`SESSION_EXPIRED` map to 401, `NOT_FOUND` maps to 404, and every other code maps to 400. Nothing
in the API answers 409.

Measured, with the request that produces it:

| Condition                                     | Status | `error.code`          |
| --------------------------------------------- | ------ | --------------------- |
| Missing `authorization` header                | 401    | `UNAUTHORIZED`        |
| Signed-out or unknown token                   | 401    | `SESSION_EXPIRED`     |
| Missing `x-cflix-profile` header              | 404    | `NOT_FOUND`           |
| `?profileId=` instead of the header           | 404    | `NOT_FOUND`           |
| Signup with a registered email                | 400    | `EMAIL_TAKEN`         |
| Signin with a wrong password                  | 400    | `INVALID_CREDENTIALS` |
| Bad Google credential                         | 400    | `INVALID_GOOGLE_TOKEN`|
| Sixth profile on an account                   | 400    | `PROFILE_LIMIT`       |
| `get` for a title above the profile ceiling   | 404    | `NOT_FOUND`           |
| `play` for a title above the profile ceiling  | 400    | `MATURITY_BLOCKED`    |
| `play` with a ref the service cannot classify | 400    | `VALIDATION`          |

A gated title answers `get` with 404 rather than `MATURITY_BLOCKED` so the endpoint does not
confirm that an adult title exists. `play` names the reason instead, because the client already
holds the title.

The profile ceiling is checked against `MATURITY_RANK` in `server/src/types.js`
(`child: 0, teen: 1, adult: 2`). An unrecognized rank compares as `undefined`, so a profile whose
`maturity` is not one of the three words sees nothing at all.

### Request and response shapes worth naming

- **Signup** returns `{"user": {...}, "session": {"token", "expiresAt"}}`. There is no `data`
  wrapper.
- **Search** takes `{ text, kind, cursor, limit }`. `nextCursor` is a decimal offset string, and
  `null` when the result set is exhausted. Browse has no cursor at all, so browse rails cannot
  page.
- **Play** takes `{ ref: { kind, id } }` and returns `{ item, manifestUrl, resumeFromSeconds }`.
  `manifestUrl` is `/stream/<id>.m3u8`, and no route serves it: `GET /stream/...` is a 404. The
  browser ignores it and embeds YouTube.
- **History** returns `{ items }` where each row is a progress entry plus `item`, or `item: null`
  when the id resolves from neither the fixture nor the provider cache.

### Headers

```
authorization: Bearer <token>     # required by every catalog, play, and progress route
x-cflix-profile: <profile id>     # required; a query parameter does not substitute for it
```

### Catalog providers

`server/src/providers/` holds one adapter each for Cinemeta, TVMaze, and Kitsu, plus `cache.js`
(a TTL cache every adapter read passes through) and `maturity.js`.

Three lookups in `server/src/catalog.js` decide which adapter answers:

- `providerForKind` — turns a browse or search `kind` into an adapter. `KIND_PROVIDER` maps
  `anime` to Kitsu; everything else uses the active provider. This is the one table, so a second
  list path cannot route around it.
- `providerForId` — an id namespace (`kitsu:`) wins over the active provider.
- `PROVIDER=off` outranks both and forces the offline seed fixture for every kind and every id.

Every provider read goes through `providerCall`, which catches failures and returns a fallback.
A provider outage therefore degrades to the seed fixture instead of an error response.

Search answers from the fixture first when the query matches a seed title, because that path is
deterministic and a repo gate pins its results; every other query goes to the provider.

### Maturity model

`maturity.js` derives an item's `child`/`teen`/`adult` tier server-side. Each catalog route
filters through `visibleTo` before returning, and `get` and `play` gate the single named title.
A child profile browsing an adult catalog sees only the child titles (measured: 3 of 24).

## Client

### Page modules

`public/wire.js` reads `document.body.dataset.page` and imports exactly one module:

| `data-page`  | Module                      | Page          |
| ------------ | --------------------------- | ------------- |
| `sign-in`    | `public/js/pages/signin.js`  | `/signin`    |
| `profiles`   | `public/js/pages/profiles.js`| `/profiles`  |
| `home`       | `public/js/pages/home.js`    | `/home`      |
| `detail`     | `public/js/pages/detail.js`  | `/title`     |
| `player`     | `public/js/pages/player.js`  | `/watch`     |
| `browse`     | `public/js/pages/browse.js`  | `/browse`    |

`public/index.html` carries no `data-page` and runs an inline script with no external file. Two
pages, `/watch` and `/browse`, ship exactly one `<script src="/wire.js">`. The other four —
`/home`, `/title`, `/profiles`, `/signin` — ship `/js/pages/nav.js` first, then `wire.js`. Only
`wire.js` consults `data-page`; `nav.js` loads unconditionally alongside it.

### Shared core

`public/js/core.js` exports five things:

- `ses` — getters and setters for the token and the whole profile object in `sessionStorage`.
- `api(path, { method, body, auth })` — attaches both headers, parses the envelope, and throws an
  error carrying `code` on any non-2xx.
- `fillRow(id, items, short)` — renders a rail of cards into a container and wires each card to
  `/title?id=`.
- `startPlay(ref)` — stashes the ref in `sessionStorage` as `cflix_play_ref` and navigates to
  `/watch`. It does not call the API; the player does.
- `fmt(s)` — seconds to `h:mm:ss`.

### Per-page behavior

- **signin** — signup, signin, and Google sign-in; each stores the session token, clears the
  active profile, and redirects to `/profiles`.
- **profiles** — lists profiles, creates one, and stores the chosen profile object in `ses`.
- **home** — loads browse rows and `/api/history` in parallel, renders a continue-watching row
  from progress, and renders search matches inline in `#row-results-wrap` with cursor
  tail-loading. Home is the only page with a `#search-form`.
- **detail** — awaits `/api/catalog/get` first, then loads `/api/history` and
  `/api/catalog/related` together. It groups `episodes[]` into seasons behind a season picker, and
  prints an inline empty message when a series returns no episode list. The related rail is a
  separate block: it hides itself when no other title shares a genre.
- **browse** — a URL-driven grid. Its cursor appends to the same query; home's search does not
  share that code path, though both call `POST /api/catalog/search`.
- **player** — reads `cflix_play_ref`, POSTs `/api/play` with `{ ref }`, and drives a
  `youtube-nocookie.com` iframe through the IFrame API. Controls stay disabled until `onReady`
  fires. Progress posts once playback passes one second, then every ten seconds of played time,
  again when the viewer backs out, and as a reset to `0` when they hit finish. One `document`
  keydown listener handles `F`, `Space`, and `M`.

## Testing

- `scripts/smoke.mjs` — HTTP smoke test of auth, profiles, catalog, and progress.
- `scripts/*-check.mjs` — one focused check per adapter and per subsystem.
- `scripts/verify/verify-*.mjs` — Playwright suites: auth, profiles, browse, playback.
- `scripts/agents-paths-check.mjs`, `scripts/agents-symbols-check.mjs` — citation guards that read
  `AGENTS.md`.
- `scripts/capture.mjs` — screenshot and tour-video capture for PRs.

`npm test` chains the citation guards, smoke, routing, maturity, and fixture conformance, and
allocates its own port. The Playwright suites are separate: `npm run verify`, or one of
`npm run verify:<suite>`.

## Known gaps

Observed behavior, not aspirations:

1. `manifestUrl` points at a `/stream` route that does not exist. Playback is YouTube-only.
2. A Kitsu series returns `episodes: []` from `get`, so an anime series page has no episode list
   (measured: `kitsu:7442` → 0 episodes, while `tt21097264` → 7).
3. Profile `maturity` is stored unvalidated, and an unrecognized value blocks every title for
   that profile.
4. Browse has no cursor, so rails cannot page.
5. State lives in memory, so a restart clears every account and profile.
