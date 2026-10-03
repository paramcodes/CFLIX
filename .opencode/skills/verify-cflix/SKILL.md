---
name: verify-cflix
description: "Verify CFLIX (the streaming prototype in this repo) by driving its real surfaces — Playwright browser for the 16 screens and static pages, plain HTTP for the JSON API. Use before claiming a UI/API change works."
---

# Verify CFLIX

CFLIX is a Node static server plus JSON API serving 16 HTML/CSS/JS screens with an in-memory store. There is no build step and no database; state resets on restart.

## Launch

```sh
PORT=3100 node server.js   # from the repo root; any free port works
```

Ready when the log prints `cflix on http://localhost:3100` and `curl -s localhost:3100/` returns HTML. Teardown: kill the PID you started (`kill $PID`); never kill by process name.

## Doctor

Read-only check that the instance is worth driving. All must pass:

- `curl -s -o /dev/null -w '%{http_code}' localhost:3100/` returns `200`.
- `curl -s -o /dev/null -w '%{http_code}' localhost:3100/screens/02-sign-in.html` returns `200`.
- `curl -s -o /dev/null -w '%{http_code}' localhost:3100/api/profiles` returns `401` (API alive, auth enforced).

A fresh instance accepts any new email for signup. If signup returns `EMAIL_TAKEN`, the store is dirty — restart the server.

## Drive

Two surfaces; use both, mock neither without noting it.

**Browser (Playwright).** Playwright is installed under `/tmp/opencode/node_modules`; run scripts with `NODE_PATH=/tmp/opencode/node_modules`. The same pattern as `scripts/capture.mjs`: launch chromium, `page.goto(base + '/screens/02-sign-in.html')`, drive by the selectors below. Every screen's behavior is wired by `public/wire.js` keyed on `document.body.dataset.page`; session state lives in `sessionStorage` keys `cflix_token`, `cflix_profile`, `cflix_play_ref`.

Stable handles:

- Sign in: `#in-email`, `#in-password`, `#btn-signin`, `#btn-signup`, `#btn-google`, error text in `#in-error`. Submit redirects to `/profiles.html`.
- Profiles: `#profile-list .avatar-tile[data-id]` (click selects, stores `cflix_profile`, goes to `screens/05-home-page.html`), `#add-profile` opens dialog `#dlg-add` (`#dlg-name`, `#dlg-maturity button[data-m]`, `#dlg-create`, `#dlg-cancel`).
- Home (`data-page="home"`): `#who` ("Watching as <name>"), `#row-movies`, `#row-series`, `#row-continue`, `#btn-switch`, `#search-form` + `#search-input`; results land in `#row-results` and `#row-results-wrap` becomes visible.
- Detail (`data-page="detail"`, needs `?id=`): `.detail__artwork span` title, `#episodes .episode-link[data-ep]`, `#btn-play`.
- Player (`data-page="player"`): `.player__title`, `#btn-finish`; progress posts every 10s of playback.

**API (plain HTTP).** `POST /api/auth/signup|signin|google`, `GET|POST /api/profiles`, `GET /api/catalog/browse|get`, `POST /api/catalog/search`, `POST /api/play`, `POST /api/progress`, `GET /api/history`. Auth via `Authorization: Bearer <token>`; profile scope via `x-cflix-profile: <id>` header. `scripts/smoke.mjs` exercises this surface end to end — it is an API probe, not UI proof.

## Evidence

- Browser proof: a Playwright screenshot of the resulting screen plus a one-line note of what action produced it. Save under `artifacts/verify-cflix/<feature>-<timestamp>.png` (create the dir).
- API proof: the request line, response status, and the relevant JSON fields (token, item id, maturity filter), saved to the same dir.
- Proof standard: exercise the user path through the UI (click `#btn-signin`, not `fetch('/api/auth/signin')`) and capture the resulting state — redirect target, row contents, `#who` text, history item — not just a final screenshot. A passing `scripts/smoke.mjs` is not live UI proof; say so when you relied on it.

## Cleanup

- Kill only the server PID you started.
- `artifacts/verify-cflix/` survives teardown; it is the record of the run.
- Restart the server to reset the in-memory store before a fresh proof.

## Helpers

- `NODE_PATH=/tmp/opencode/node_modules node scripts/capture.mjs <outdir> [baseUrl]` — screenshots + tour video of the real screens.
- `PORT=3100 node scripts/smoke.mjs` — API-level probe; complements, never replaces, browser proof.
- The feature map in `features/` is the maintained source of user-facing flows: `features/README.md` indexes them.

## Isolation

Two instances can run side by side only on different `PORT`s. Session state is per-tab (`sessionStorage`), so two browser contexts on one port are safe; the store is shared, so prefer a fresh server per run.
