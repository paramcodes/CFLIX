---
name: verify-cflix
description: "Verify CFLIX (the streaming platform) by driving its real surfaces — Next.js 16 App Router & static prototype in Playwright, fast in-memory integration runner, and plain HTTP for the JSON API."
---

# Verify CFLIX

CFLIX features a modern **Next.js 16 (React 19) App Router** client with Tailwind CSS and TanStack Query, backed by a Node.js API server with **Drizzle ORM + SQLite persistence** (`data/cflix.db`), **Anti-Corruption Layer (Boundary)**, and **Circuit Breakers**.

## Launch

```sh
# Option 1: Backend API & Prototype Server
PORT=3100 node server/index.js   # from repo root; any free port works

# Option 2: Modern Next.js App Router (Dev Server)
npm run dev:next

# Option 3: Production Next.js Build
npm run build:next
```

Ready when the log prints `cflix on http://localhost:3100` and `curl -s localhost:3100/` returns HTTP 200. Teardown: kill the PID you started (`kill $PID`).

## Doctor

Read-only check that the instance is worth driving. All must pass:

- `npm run test:fast` returns PASS in < 450ms (in-memory verification of routes & boundary).
- `curl -s -o /dev/null -w '%{http_code}' localhost:3100/` returns `200`.
- `curl -s -o /dev/null -w '%{http_code}' localhost:3100/signin` returns `200`.
- `curl -s -o /dev/null -w '%{http_code}' localhost:3100/api/profiles` returns `401` (API alive, auth enforced).

## Drive

### 1. Fast In-Memory Verification (< 450ms)
```sh
npm run test:fast
```
Exercises all route endpoints, boundary validation, maturity enforcement, and watch progress directly in memory without port allocation.

### 2. Browser Verification (Playwright)
```sh
npm run verify
npm run check:player
```
Drives authentication, profile switching, lazy rails, and video playback on a real browser.

Stable handles:
- **Sign in**: `#in-email`, `#in-password`, `#btn-signin`, `#btn-signup`.
- **Profiles**: `#profile-list .avatar-tile[data-id]`, `#add-profile` opens dialog `#dlg-add`.
- **Home**: `#hero`, `#row-trending`, `#row-movies`, `#row-series`, `#row-anime`, `#row-continue`.
- **Detail**: `#detail-title`, `#episodes .episode-link`, `#btn-play`.
- **Player**: `.player__title`, `#btn-toggle`, `#seek`, `#vol`, `#btn-mute`, `#btn-full`.
- **Browse**: `#browse-grid`, `#browse-tabs`, `#browse-genre`.

### 3. API (plain HTTP)
`POST /api/auth/signup|signin`, `GET|POST /api/profiles`, `GET /api/catalog/browse|get`, `POST /api/catalog/search`, `POST /api/play`, `POST /api/progress`, `GET /api/history`.

`POST /api/auth/google` still exists but has no UI behind it and no way to pass verification, so a
default server answers `400 INVALID_GOOGLE_TOKEN` for every token. Do not expect a session from it.

## Helpers

- `npm run test:fast` — Fast in-memory API test suite.
- `npm run check:player` — Full Playwright test suite for video player controls and playback.
- `npm run capture <outdir> [baseUrl]` — Video and screenshot capture.
- `features/README.md` — Detailed feature maps and recipes.
