# CFLIX

CFLIX is a streaming-service prototype: a Node static server plus a JSON API serving 7 HTML pages, backed by an in-memory store and three catalog provider adapters.

## Pages

`PAGE_MAP` in `server/index.js` serves seven clean routes.

| Route       | File                       |
| ----------- | -------------------------- |
| `/`         | `public/index.html`        |
| `/signin`   | `public/(auth)/signin.html` |
| `/profiles` | `public/profiles.html`     |
| `/home`     | `public/home.html`         |
| `/title`    | `public/title.html`        |
| `/watch`    | `public/watch.html`        |
| `/browse`   | `public/browse.html`       |

Six of them carry `data-page` on `<body>` and load exactly one module from `public/js/pages/` through `public/wire.js`. The landing page at `/` runs an inline script instead, and `/home`, `/title`, `/profiles`, and `/signin` also load `public/js/pages/nav.js` alongside `wire.js`; only `/watch` and `/browse` ship `wire.js` alone.

## Catalog

`server/src/providers/` holds one adapter each for Cinemeta, TVMaze, and Kitsu, plus a cache and the maturity gate. `server/src/providers/contract.js` defines the item shape every adapter must return. Set `PROVIDER=off` to serve the offline seed fixture instead of a live provider.

## Domain model

See [design.md](design.md) for the domain model, types, and signatures.

## Quick start

```sh
npm start
```

Open http://localhost:3000. `PORT` overrides the port.

## Test

```sh
npm test
```

The runner allocates a free port, starts a server, runs the checks, and tears the server down, so it is safe to run repeatedly and beside a server you started yourself.

```sh
npm run test:paths      # AGENTS.md path citations
npm run test:symbols    # AGENTS.md symbol citations
npm run test:smoke      # API and page smoke test
npm run test:routing    # provider routing under PROVIDER=off
npm run test:maturity   # episode maturity guard
npm run test:fixture    # seed fixture against contract.js
```

Run one adapter's checks with `npm run test:adapters`, or a single subsystem check with its `npm run check:<name>` key.

## Lint and format

```sh
npm run lint
npm run format:check
```

## Browser verification

```sh
npm run verify
```

`npm run verify` drives the real pages in Playwright across four suites: auth, profiles, browse, and playback. Each suite also runs on its own as `npm run verify:auth`, `verify:profiles`, `verify:browse`, or `verify:playback`.

## Capture media

Start a server first, then run the capture script. It needs a live server to load pages from.

```sh
npm start
npm run capture <outdir> [baseUrl]
```

The base URL defaults to `http://localhost:3000`.

## Screenshots

![Index](https://raw.githubusercontent.com/paramcodes/CFLIX/main/docs/revamp/index-after.png)

![Home](https://raw.githubusercontent.com/paramcodes/CFLIX/main/docs/revamp/home-after.png)
