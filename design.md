# CFLIX Design

CFLIX is a modern streaming-service platform featuring a Node HTTP server with an Anti-Corruption Layer,
Drizzle ORM + SQLite persistence, upstream Circuit Breakers, a Multi-Tier L1/L2 cache, and a
Next.js 16 (React 19) App Router client alongside the vanilla prototype.

This file documents the system as it ships. `server/src/providers/contract.js` is the source of
truth for catalog shapes; every status code and envelope below was verified against the running system.

## Stack

- **Server**: Node HTTP server. `server/index.js` is the entrypoint with route dispatch, ETag static
  caching, and an exported in-memory `handleRequest()` handler for sub-millisecond testing.
- **Anti-Corruption Layer**: `server/src/boundary.js` validates inbound payloads and query parameters
  before they reach domain services, enforcing branded IDs (`AccountId`, `ProfileId`, `MediaId`).
- **Persistence**: SQLite with WAL (Write-Ahead Logging) mode in `data/cflix.db`, managed via
  **Drizzle ORM** schemas (`server/src/db/schema.js`) and Domain Repository Ports (`server/src/domain/ports.js`).
  Supports in-memory (`:memory:`) databases for hermetic unit testing.
- **Resilience**: Upstream Circuit Breakers in `server/src/resilience/circuit-breaker.js` wrapping
  Cinemeta, TVMaze, and Kitsu to prevent thread starvation and socket exhaustion during upstream outages.
- **Cache**: Multi-Tier Composite Cache in `server/src/providers/cache.js` combining a sub-millisecond
  in-memory L1 LRU cache with an atomic file-backed L2 disk cache.
- **Playback**: Strategy Pattern in `public/js/player/` (`VideoPlayerEngine`), decoupling transport UI
  controls from concrete video backends (YouTube IFrame API, native HTML5 `<video>`, and HLS).
- **Client**:
  - **Modern App Router**: Next.js 16 + React 19 + Tailwind CSS + TanStack Query with lazy-loading vertical
    rails in `src/`.
  - **Prototype**: Vanilla ES modules in `public/` loaded via `public/wire.js`.
- **Tests**: Fast in-memory unit tests (`test/api.test.js`, `test/db.test.js`, `test/circuit-breaker.test.js`)
  via native `node:test`, plus integration check scripts and Playwright browser verification.

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

A profile is `{ id, accountId, name, maturity }`, where `maturity` is validated at the boundary
as one of `child`, `teen`, `adult` and defaults to `adult`. An account holds at most five profiles.

A session is `{ token, accountId, expiresAt }` persisted in SQLite. The browser keeps both session
and active profile in `sessionStorage` under `cflix_token` and `cflix_profile`.

### Progress

`{ id, profileId, itemId, seconds, updatedAt }`, keyed by `profileId:itemId`. It feeds the
continue-watching row and the resume point handed back by `play`, persisted in SQLite.

## Server

### Routes

`server/index.js` matches on the exact string `` `${method} ${pathname}` ``, with all input
validated at the `Boundary` layer:

| Method | Path                    | Notes                                    |
| ------ | ----------------------- | ---------------------------------------- |
| POST   | `/api/auth/signup`      | Validates email/password; returns `{ user, session }` |
| POST   | `/api/auth/signin`      | Validates credentials; returns `{ user, session }` |
| POST   | `/api/auth/google`      | Verifies Google credential               |
| POST   | `/api/auth/signout`     | Deletes session; returns `{ ok: true }`  |
| GET    | `/api/profiles`         | Returns `{ items: [...] }`               |
| POST   | `/api/profiles`         | Validates name/maturity; creates profile |
| GET    | `/api/catalog/browse`   | Returns `{ items }` filtered by maturity |
| GET    | `/api/catalog/get`      | Returns single title or 404              |
| GET    | `/api/catalog/related`  | Returns titles sharing a genre           |
| POST   | `/api/catalog/search`   | Returns `{ items, nextCursor }`          |
| POST   | `/api/play`             | Resolves playback item and resume point  |
| POST   | `/api/progress`         | Upserts watch position in SQLite         |
| GET    | `/api/history`          | Returns watch history, newest first      |

### Catalog providers & Resilience

`server/src/providers/` holds adapters for Cinemeta, TVMaze, and Kitsu.

Every provider read goes through `providerCall` in `server/src/catalog.js`, which is protected
by a named `CircuitBreaker`:
- `CLOSED`: Normal operation; requests pass through to the adapter.
- `OPEN`: Fast-fails to fallback in < 0.01ms after 5 consecutive failures, avoiding socket hangs.
- `HALF_OPEN`: Probes upstream health after a 10s cooldown.

## Client

### Modern Next.js Frontend (`src/`)

- Built with Next.js 16, React 19, Tailwind CSS v4, and TanStack Query.
- **Above-The-Fold Optimization**: Initial load fetches only the Hero and Trending Top 10 rows.
- **Vertical Lazy Rails (`<LazyRail />`)**: Uses `IntersectionObserver` to trigger catalog queries
  only when lower shelves approach within 400px of the viewport.
- **Client Cache**: TanStack Query caches catalog items for 5 minutes and prevents duplicate fetches.

### Video Player Engine Strategy (`public/js/player/`)

The playback architecture uses the Strategy Pattern:
- `VideoPlayerEngine`: Abstract strategy contract with `play()`, `pause()`, `seekTo()`, `setVolume()`.
- `YouTubePlayerEngine`: Adapter encapsulating YouTube Iframe API.
- `Html5VideoEngine`: Adapter supporting native HTML5 `<video>` streams.
- `createPlayerEngine()`: Factory selecting the optimal engine based on media source metadata.

## Testing & Quality

- `npm run test:fast` — Native `node:test` in-memory integration test suite (< 450ms).
- `node --test test/circuit-breaker.test.js` — Circuit breaker state machine unit tests.
- `node --test test/db.test.js` — Drizzle SQLite repository unit tests.
- `npm test` — Full hermetic gate suite (paths, symbols, smoke, routing, maturity, fixture).
- `npm run check:player` — Playwright browser suite verifying player controls and playback.
- `npm run verify` — Automated browser verification across all features.

## Enterprise Streaming Enhancements (Stage 7 — delivered)

- **Spatial Navigation**: `src/lib/spatial-nav.ts` (`SpatialNavigationEngine`) implements 2D geometric focus movement via Euclidean distance + angular cone filtering (`SpatialNavigationPort`). Enables 10-foot Smart TV D-Pad navigation.
- **Subtitle / Audio Tracks**: `SubtitleTrack` and `AudioTrack` interfaces in `server/src/domain/ports.ts`; contracts in `server/src/providers/contract.js` for multi-language subtitles and audio description.
- **Rate Limiting**: `SlidingWindowRateLimiter` in `server/src/resilience/rate-limiter.ts`; sliding-window quota guard (`RateLimiterPort`) for auth/search abuse protection.
- **Client Type Safety**: `src/lib/api.ts`, `src/lib/query-client.ts`, `src/lib/utils.ts` fully typed with zero inline-cast access; `fetchApi<T>()` generic with `in` narrowing.

## Testing (current)

- `npm run test:fast` (Vitest): 6 files, 31 tests, ~4s.
- `npm test` (full hermetic gate): 63 path citations (0 broken), 11 symbol citations (0 broken), smoke 15 PASS/0 FAIL, fixture PASS.
- `npm run typecheck`: `tsc --noEmit` clean (0 diagnostics).
