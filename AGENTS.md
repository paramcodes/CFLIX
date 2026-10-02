# AGENTS.md

## Repo layout

- `server.js` — Node static server and JSON API entrypoint.
- `src/` — server-side modules (`store.js`, `services.js`, `catalog-data.js`, `types.js`).
- `public/` — static assets; `public/screens/` holds the 16 HTML/CSS/JS screens.
- `scripts/smoke.mjs` — smoke test against a running server.
- `scripts/capture.mjs` — Playwright capture of screenshots and a tour video.
- `docs/revamp/` — before/after media.
- `design.md` — domain model and types.

## Run the server

```sh
node server.js        # default port 3000; override with PORT
```

## Run the smoke test

```sh
PORT=3000 node server.js &
PORT=3000 node scripts/smoke.mjs
```

## Capture media

```sh
NODE_PATH=/tmp/opencode/node_modules node scripts/capture.mjs <outdir> [baseUrl]
```

## Conventions

- Visual changes require screenshots, a video, and a "What changed" section in the PR.
- One small issue per change.
- The smoke test must pass.
- Worktrees per task.
- Do not touch files outside your issue's scope.
