# CFLIX verification map

This directory is the maintained source for verifying the user-facing behavior of CFLIX. Read this index, then use the matching feature file as the recipe. The app itself is covered by `../SKILL.md`.

## Baseline preconditions

- Launch CFLIX at a free port (example `PORT=3100 node server/index.js`).
- Run the Doctor checks from `../SKILL.md` before driving.
- Restart the server between runs for a clean in-memory store unless a feature says otherwise.
- Drive the UI through Playwright; drive the API with plain HTTP. Never trust `scripts/smoke.mjs` alone as UI proof.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a screenshot of the resulting screen and a note of the action that produced it.
- Mutation proof includes a read-only second view of the stored value (a second GET, or the rendered row/count).
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Sign in and sign up](./auth-signin.md) covers password sign-in, sign-up, Google stub, and error states on the sign-in screen.
- [Profile selection](./profiles.md) covers listing profiles, creating one with a maturity, and selecting one.
- [Browse and search](./browse-and-search.md) covers home rows, continue watching, title search on the home screen, and the `/browse` grid.
- [Playback and progress](./playback.md) covers detail view, starting playback, and progress flowing back into continue watching.
