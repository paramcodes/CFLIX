# AGENTS.md

## Conventions

- Visual changes require screenshots, a video, and a "What changed" section in the PR. `npm run verify`
  writes none on a green run, so ask for them with `SAVE_SHOTS=1 npm run verify` or `npm run capture`;
  add `CFLIX_SHOT_DIR=<dir>` to keep the captures out of the tracked `artifacts/`. A failing check
  always captures one screenshot on its own, so `npm run verify` still leaves evidence of a break.
- One small issue per change.
- The smoke test must pass (`npm test`).
- Keep `main` in sync with `origin/main`.
- Do not touch files outside your issue's scope.


- **Search & Grep**: `.ignore` and `.prettierignore` exclude the worktrees directory, `.opencode/`,
  and `artifacts/` to keep search instantaneous and prevent duplicate matches across worktrees.

- **Worktrees**: worktrees live under the directory `.gitignore` excludes, and each needs its
  `node_modules` symlinked to the root's because worktrees get no copy of their own. Treat any
  unregistered directory there as scratch rather than work. `git worktree list` is the command that
  answers what is real, and nothing under that directory may be cited as evidence, because a fresh
  clone does not have it.
