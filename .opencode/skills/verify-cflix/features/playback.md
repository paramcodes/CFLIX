# Playback and progress

From the detail view the user starts playback of a movie, episode, or series; the player screen shows the resolved title and elapsed time, reports progress every 10 seconds, and finishing returns home where the item appears in continue watching.

## Sub-features

- `detail-open` opens the detail view for a title id.
- `detail-episodes` lists season episodes for a series.
- `play-start` resolves the ref and opens the player.
- `progress-report` posts watch position while playing.
- `history-row` shows the played item under continue watching.

## How to get to it (user POV)

- Click a card on the home rows.
- Click an episode link inside the detail view.

## Driving it with Playwright

Preconditions:

- Signed in, profile selected, catalog seeded.
- Open `/home`.

- **Open detail.** Click a movie card. Run `page.locator('#row-movies .card').first().click()`. URL becomes `/title?id=...` and `.detail__artwork span` shows the title.
- **Episodes for series.** Open a series card. Run `page.locator('#row-series .card').first().click()`. `#episodes` lists `.episode-link` entries with `S x E` numbering.
- **Start playback.** Click play. Run `page.click('#btn-play')`. URL becomes `/watch`, `.player__title` matches the resolved item.
- **Progress.** Wait about 12 seconds on the player page; `GET /api/history` (with the same token and `x-cflix-profile`) then returns the item with `seconds > 0`.
- **Finish.** Run `page.click('#btn-finish')`. The browser returns to `/home` and `#row-continue` may be empty (finish resets progress to 0) — the meaningful proof is the `/api/history` read before finishing.
- **Proof.** Screenshot the player title and the history API response saved under `artifacts/verify-cflix/`.

## Gotchas

- The player screen requires `sessionStorage.cflix_play_ref`; opening it directly redirects to the home page.
- `#btn-finish` posts `seconds: 0`, clearing the position; capture history before clicking it.
- Series play resolves server-side to the next unwatched episode; the resolved title in `.player__title`, not the ref, is the proof.
