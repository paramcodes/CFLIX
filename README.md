# CFLIX

CFLIX is a streaming-service prototype: a Node static server plus a JSON API serving 16 HTML/CSS/JS screens, backed by an in-memory store.

## Domain model

See [design.md](design.md) for the domain model and types.

## Quick start

```sh
node server.js
```

Open http://localhost:3000.

## Smoke test

```sh
PORT=3000 node server.js &
PORT=3000 node scripts/smoke.mjs
```

## Capture media

Use `scripts/capture.mjs` for screenshots and the tour video:

```sh
NODE_PATH=/tmp/opencode/node_modules node scripts/capture.mjs <outdir> [baseUrl]
```

## Screenshots

![Index](https://raw.githubusercontent.com/paramcodes/CFLIX/main/docs/revamp/index-after.png)

![Home](https://raw.githubusercontent.com/paramcodes/CFLIX/main/docs/revamp/home-after.png)
