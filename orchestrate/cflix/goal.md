# arch-audit program: make this repo's architecture agent-friendly

## Objective

Close the mistake classes that shipped as real bugs and that no gate currently catches, by replacing
unenforced prose with architecture and checks. Derived from the measured audit in
`.opencode/agents/arch-audit.md`.

## Done condition

All six conditions, each falsifiable by a command:

1. A test exists that fails if `KIND_PROVIDER` is dropped from `providerBrowseItems`. Proof it was
   real: on `main` at `25a6755`, reintroducing the PR #47 defect left `npm test` at 0 failures and all
   four `npm run verify` suites green.
2. A test exists that fails if `EPISODE_ID` loses its Cinemeta branch. Proof it was real: on `main` at
   `25a6755`, reintroducing the PR #40 defect made `POST /api/play {kind:'episode', id:'tt1844624:1:3'}`
   return `NOT_FOUND "no such series"` while every gate stayed green.
3. `server/src/catalog-data.js` satisfies every key `server/src/providers/contract.js` declares for
   `CatalogItem` and `Episode`, carries no duplicate episode id, and namespaces every fixture id with
   `seed:`. `npm test` fails if any of the three breaks.
4. No `scripts/*-check.mjs` hardcodes a default port, and every check script is reachable from an npm
   script.
5. A check fails when `AGENTS.md` cites a file path that does not resolve. Measured need: 10 of 64
   cited paths do not resolve today, 9 of them under gitignored `.worktrees/`.
6. `npm test`, `npm run verify`, `npm run lint`, `npm run format:check` are green on `main` at every
   merge, with the same or higher pass counts than the 26 / 31 / 0-errors baseline.

## Budget

- Wall-clock ceiling: 16 hours from first owner dispatch.
- Audit tick ceiling: 12 ticks.

Raised from 8 hours / 8 ticks by the operator's explicit grant on 2026-10-05, after B, C, D and E
were dispatched concurrently and the remaining owner work no longer fit the original cap. The raise
is a grant, not a rollover.

When either is spent the program reports its state and stops. It does not roll over.

## Queue

| # | PR | Files | Owner state |
|---|----|-------|-------------|
| A | Correctness core: regression tests for the kind-table and episode-ref defects, then fix both causes | `package.json`, `scripts/provider-routing-check.mjs`, `server/src/catalog.js`, 3 adapters | merge-ready at `63438ba`, PR 58, awaiting Lane 1 |
| B | Harness migration: delete 5 hardcoded ports, move orphan checks onto `scripts/verify/harness.mjs`, flaky-media triage | `scripts/*-check.mjs`, `scripts/verify/harness.mjs`, `package.json` | running |
| C | `AGENTS.md` path-resolution check, then the rule table rewrite | `AGENTS.md`, new check script, `package.json` | running |
| D | Performance baseline: gate, endpoint, and page-load timings | new timing script, `package.json` | running |
| E | Cinemeta episode maturity: `GET` on an episode ref 404s because `toEpisodes` omits `maturity` | `server/src/catalog.js` or the adapters, test, `package.json` | running |

### Fan-out correction

The first cut of this plan serialized B, C, and D behind A's merge on the stated grounds that A edits
`scripts/smoke.mjs` and `scripts/verify/verify-browse.mjs`, which B would otherwise migrate. That
claim was wrong on re-checking the file lists. A's seven files and B's targets are disjoint except
`package.json`, so the only real collision is one file's `scripts` block, which resolves as a text
merge keeping both sides' entries.

B, C, D, and E therefore run concurrently from `main`, each in its own worktree and branch. E was
added after Lane 2's finding F3 and was not in the original six phases.

Merge order is not fixed. Each PR rebases onto current trunk at merge prep and resolves `package.json`
by keeping both sides.

## Ground rules

- `gh` is the only forge CLI. `origin` is not installed and no step may depend on it.
- `main` has no branch protection and there is no CI. The local gates are the CI. Run them at the
  merge-ready head.
- One writer per worktree under `.worktrees/`. Reviewers and verifiers never write into an owner's
  tree.
- Never add `artifacts/` to `.gitignore`. The verify suites write there on every run, so a stray
  glob delete removes tracked evidence. Restore with `git checkout -- artifacts/`.
- Never rewrite `AGENTS.md` from a version lacking its `Learned Workspace Facts` section. Prove any
  rewrite against `git show origin/main:AGENTS.md`.
- Squash merges only. `git merge-base --is-ancestor` proves nothing about whether work landed; ask
  `gh pr view <n> --json state,mergedAt`.

## Completion (2026-10-05T23:58Z)

All six PRs merged, in order #58 → #61 → #62 → #59 → #63 → #60; trunk `61d3e09`, zero open PRs.
Each PR landed only after a verification lane returned VERIFIED at the exact merge-ready head:
#58 twice, #61 once, #62 once, #59 once, #63 (lane INCONCLUSIVE on a disk-full box, re-proved
green by the root agent at the same head after the cause was found), #60 after four rounds
(2 blockers → 2+4 findings → 7 findings → VERIFIED at `b24d644`).

Done-conditions re-proved on final trunk with their falsifiable commands (2026-10-06):

| # | Command | Result |
|---|---------|--------|
| 1 | reintroduce PR #47 defect in `providerBrowseItems`, run `provider-routing-check.mjs` | `FAIL browse?kind=anime routes to kitsu`, exit 1; baseline/restored 0 |
| 2 | break Cinemeta's `EPISODE_REF`, run the same check | `FAIL play resolves a cinemeta episode ref to its episode`, exit 1; baseline/restored 0 |
| 3 | three separate fixture mutations (drop `seed:`, delete a contract key, collide two episode ids) | each `fixture-conformance FAIL … in 1 of 3 conditions`, exit 1; stage 6 of `npm test` |
| 4 | port-literal grep over `scripts/*-check.mjs`; npm-key diff | 0 files with port literals; 16 check scripts, missing key `[]` |
| 5 | append an unresolvable citation, run `test:paths` | `FAIL … [unresolved]`, exit 1, symbols unaffected; baseline 64 citations, 0 unresolved |
| 6 | gates at `61d3e09` | test 0 (54 ^PASS ≥ 26), verify 0 (31 ≥ 31), lint 0 errors, format clean |

Budget: first owner dispatch ~13:47 IST 2026-10-05, completion 05:28 IST 2026-10-06 ≈ 15h41m of
the 16-hour ceiling. Follow-up backlog was reported to the operator and is not part of this
objective.

## Baseline at program start

Trunk `25a6755`, local `main` equal to `origin/main`.

| Gate | Result |
|------|--------|
| `npm test` | 26 pass, 0 fail, 1.3s, hermetic, no Playwright |
| `npm run verify` | 31 pass, 0 fail across 4 suites, 18.9s |
| `npm run lint` | 0 errors, 12 warnings |
| `npm run format:check` | clean |
| orphan check scripts | 9 scripts, 4964 lines, in no npm script |
| hardcoded default ports | 3217, 3194, 3294, 3311, 3241 |
| AGENTS.md | 3723 words, 64 cited paths, 10 unresolvable |