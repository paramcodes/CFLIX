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

## Enforceable rule table (Correct — encode lessons in structure)

| Rule | What it prevents | Enforced by | Evidence of past mistake |
|---|---|---|---|
| Visual changes need screenshots + video + "What changed" | PRs missing evidence | Process (verify, capture); no lint exists — add CI gate or pre-commit | Frequent fix branches with missing shots |
| One small issue per change | Large mixed PRs | Code review / `git diff --stat` gate | Recent fix branches s1-s4 mixing fixes |
| Smoke test passes (`npm test`) | Broken main | CI (`npm test`) | Recent fix branch names without green smoke |
| Do not touch outside scope | Scope creep | `git diff --name-only` vs issue | Recent fix branch R1 conflicts kept main versions incorrectly |
| No non-null assertions (`!`) | Hidden runtime errors | `biome.json` `noNonNullAssertion: error` | `EpisodeList.tsx:33` `seasonsMap.get(s)!.push(ep)` |
| No unused imports / params | Incomplete refactoring | Biome rules noUnusedImports and noUnusedFunctionParameters set to error | Removed unused React imports from EpisodeList and LazyRail components |
| Use optional chain (`?.`) | Verbose null checks | `biome.json` `useOptionalChain: error` | `LazyRail.tsx` `data && data.length > 0` |
| No explicit `any` | Type holes | `biome.json` `noExplicitAny: error` | Past casts / untyped adapters |
| Worktrees not cited as evidence | False citations | `AGENTS.md` + `.ignore`; agent instruction only — no automated gate yet | Worktree citation errors in prior transcripts |
