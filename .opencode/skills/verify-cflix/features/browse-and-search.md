# Browse and search

The home screen shows rows of movies, series, and continue watching for the selected profile, and a search box that filters the catalog by title. The same search is also available on `/browse`, a full-page grid driven by the query string.

## Sub-features

- `home-rows` renders a shuffled hero billboard, a ranked trending row, movie, series, and anime rows, and up to two generated genre rails.
- `home-continue` shows watch history in the continue watching row.
- `search-title` filters by title text, inline in `#row-results`.
- `search-maturity` hides adult titles for a child profile.
- `browse-page` renders `/browse` as a grid whose `q`, `kind`, and `genre` live in the URL, with a live count line, an empty state, and an error state.

## How to get to it (user POV)

- After selecting a profile on `/profiles`.
- After finishing playback (`#btn-finish` on the player screen).
- "Switch profile" clears the profile and returns to `/profiles`.
- `/browse` directly, or from home's `Browse all results for "…"` link in `#row-results-wrap`, or from the nav. With a token but no selected profile, `/browse` redirects to `/profiles` the same way `/home` does.

## Driving it with Playwright

Preconditions:

- Signed in and a profile selected (`sessionStorage.cflix_token` and `cflix_profile` set).
- Open `/home`.

- **Rows render.** Run `await page.locator('#row-movies .card').count()` and `#row-series .card`. Both are greater than zero for a seeded catalog.
- **Continue watching.** If history exists, `#row-continue .card` lists those items. On a fresh store it is empty.
- **Search.** Type a title and submit. Run `page.fill('#search-input', 'dark')`, `page.click('#search-form button')`. `#row-results` contains two cards titled `The Dark Knight` and `Dark` and `#row-results-wrap` is visible.
- **Empty search.** Submit `#search-input` with a term that matches nothing. `#row-results` has zero cards and the wrap is visible.
- **Maturity.** Select a `child` profile first. Run `page.evaluate(() => fetch('/api/catalog/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sessionStorage.getItem('cflix_token'), 'x-cflix-profile': JSON.parse(sessionStorage.getItem('cflix_profile')).id }, body: JSON.stringify({ text: '' }) }).then(r => r.json()))`. Every returned item has `maturity !== 'adult'`. The same gate is visible in the UI: with a `child` profile, `page.fill('#search-input', 'dark')` plus `page.click('#search-form button')` leaves `#row-results` at zero cards while `#row-results-wrap` stays visible.
- **Proof.** Screenshot the home rows and the results row; record the search term and result count.

### `/browse`

Preconditions: same as above. `page.goto(base + '/browse')`.

- **Grid renders.** On a fresh `/browse` with no query, `#browse-count` reads `24 titles` and `#browse-grid` holds 24 `.browse__card` elements.
- **Search entry point.** From home, search `dark`, then click `#row-results-wrap .browse-link`. The URL becomes `/browse?q=dark`, `#browse-count` reads `2 titles for “dark”` (curly quotes), and the grid holds 2 cards.
- **Kind tab writes the URL.** `page.click('#browse-tab-movie')` produces `/browse?q=dark&kind=movie`. `page.goBack()` restores `/browse?q=dark`.
- **Genre select writes the URL.** `page.selectOption('#browse-genre', 'horror')` appends `genre=horror` and the count line picks up ` in Horror`.
- **Anime is search-only.** `page.click('#browse-tab-anime')` with an empty query yields `#browse-count` of `0 titles`, `#browse-empty` visible reading "The anime catalog is search-only. Type a title to search it.", and **no** `/api/catalog/*` request fires.
- **Browse does not page.** `#browse-more` stays hidden on a browse-only grid: `GET /api/catalog/browse` answers `{items}` with no cursor.
- **Proof.** Screenshot the grid, the anime empty state, and the count line after a kind change.

## Gotchas

- Home redirects to `/profiles` when `cflix_profile` is unset; `/browse` does the same. A context with no token at all goes to `/signin` instead.
- Progress posts from the player screen feed continue watching; a fresh server has an empty `#row-continue`.
- Search results replace `#row-results` content; the wrap stays visible until the page reloads. The results row also tail-loads further pages from `nextCursor`, so a query with more than 12 hits appends rather than replacing.
- `POST /api/catalog/browse` takes only `kind` and `genre` and returns no cursor, so browse rails and the `/browse` grid never page. Only search returns `nextCursor`.
- The search expectations assume an adult/teen-visible profile. A child profile filters out both teen seed items (`The Dark Knight`, `Dark` — both `maturity: 'teen'` in `server/src/catalog-data.js`), so `dark` returns 0 cards there. Filtering is `maturityAllowed` (`server/src/types.js` lines 1-5, rank `child: 0, teen: 1, adult: 2`) applied in `server/src/catalog.js`. Select an adult profile before asserting the two-card result.
- Give a search request time to land before asserting an empty result. Under load a 1200 ms wait after submit still showed the previous results; 2000 ms was enough to see `#row-results` drop to zero cards.
