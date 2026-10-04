# Playback and progress

From the detail view the user starts playback of a movie, episode, or series; the player screen shows the resolved title and elapsed time, reports progress while a trailer plays, and finishing returns home where the item still appears in continue watching with its progress bar cleared.

## Sub-features

- `detail-open` opens the detail view for a title id.
- `detail-episodes` lists season episodes for a series.
- `play-start` resolves the ref and opens the player.
- `progress-report` posts watch position while the trailer plays.
- `history-row` shows the played item under continue watching.

## How to get to it (user POV)

- Click a card on the home rows.
- Click an episode link inside the detail view.

## Driving it with Playwright

Preconditions:

- Signed in, profile selected, catalog seeded.
- Open `/home`.

- **Open detail.** Click a movie card. Run `page.locator('#row-movies .card').first().click()`. URL becomes `/title?id=...` and `#detail-title` carries the title as text. Assert `textContent`, not visibility: when `#detail-logo` loads, `detail.js` adds `.detail__sr` and `detail.css` clips the heading to 1x1 px, so the title a user sees is the logo image.
- **Episodes for series.** Open a series card. Run `page.locator('#row-series .card').first().click()`. `#episodes` lists `.episode-link` rows grouped under `.detail__ephead` reading `Season N`. Each row shows a bare number in `.ep__num` and the episode title in `.ep__name`; there is no `S x E` text on this screen.
- **Start playback.** Click play. Run `page.click('#btn-play')`. URL becomes `/watch`; wait for `cflix_play_ref` to clear (the player consumes it on load), then `.player__title` fills with the resolved title. For a series that is the resolved **episode** title, not the series title — capture `#episodes .ep__name` values on the detail page first and assert against those. `#epnum` reads `S1:E1`.
- **Trailer badge.** `#media-badge` reads one of `TRAILER`, `NO PREVIEW`, `UNAVAILABLE`.
- **Progress.** Only meaningful when the badge reads `TRAILER`: wait about 12 seconds on the player page, then `GET /api/history` (with the same token and `x-cflix-profile`) returns the item with `seconds > 0`. With `NO PREVIEW` or `UNAVAILABLE` nothing posts.
- **Finish.** Run `page.click('#btn-finish')`. The browser returns to `/home` and `#row-continue .card` still lists the item, with its progress bar cleared — `#row-continue .card[data-pct]` is empty. The row does not disappear on finish.
- **Back.** Run `page.click('#btn-back')` instead of finishing: the position is posted and the browser returns to `/title?id=...`, keeping progress.
- **Proof.** Screenshot the player title and the history API response saved under `artifacts/verify-cflix/`.

## Gotchas

- The player screen requires `sessionStorage.cflix_play_ref`; opening it directly redirects to the home page.
- `.player__title` is empty markup on load; wait for `cflix_play_ref` to clear before asserting on it, or you read an empty string.
- `#btn-finish` posts `seconds: 0`, clearing the position; capture history before clicking it. The continue-watching row itself survives — only its progress bar is removed.
- Series play resolves server-side to the next unwatched episode; the resolved episode title in `.player__title`, not the ref, is the proof.
- The player embeds a muted YouTube trailer, not the full title: it is announced by `#media-badge` and the notice "Trailer only. CFLIX has no full-length stream for this title." Progress posts only while that trailer actually plays, and one run in three sees no iframe at all. Re-run a media-only failure before treating it as a regression.
- A series whose provider returned no episodes shows "This provider returned no episode list for this title." in place of `#episodes`.
