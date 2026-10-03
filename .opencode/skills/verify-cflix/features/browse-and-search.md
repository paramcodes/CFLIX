# Browse and search

The home screen shows rows of movies, series, and continue watching for the selected profile, and a search box that filters the catalog by title.

## Sub-features

- `home-rows` renders movie and series rows from the catalog.
- `home-continue` shows watch history in the continue watching row.
- `search-title` filters by title text.
- `search-maturity` hides adult titles for a child profile.

## How to get to it (user POV)

- After selecting a profile on `/profiles`.
- After finishing playback (`#btn-finish` on the player screen).
- "Switch profile" clears the profile and returns to `/profiles`.

## Driving it with Playwright

Preconditions:

- Signed in and a profile selected (`sessionStorage.cflix_token` and `cflix_profile` set).
- Open `/home`.

- **Rows render.** Run `await page.locator('#row-movies .card').count()` and `#row-series .card`. Both are greater than zero for a seeded catalog.
- **Continue watching.** If history exists, `#row-continue .card` lists those items. On a fresh store it is empty.
- **Search.** Type a title and submit. Run `page.fill('#search-input', 'dark')`, `page.click('#search-form button')`. `#row-results` contains two cards titled `The Dark Knight` and `Dark` and `#row-results-wrap` is visible.
- **Empty search.** Submit `#search-input` with a term that matches nothing. `#row-results` has zero cards and the wrap is visible.
- **Maturity.** Select a `child` profile first. Run `page.evaluate(() => fetch('/api/catalog/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sessionStorage.getItem('cflix_token'), 'x-cflix-profile': JSON.parse(sessionStorage.getItem('cflix_profile')).id }, body: JSON.stringify({ text: '' }) }).then(r => r.json()))`. Every returned item has `maturity !== 'adult'`.
- **Proof.** Screenshot the home rows and the results row; record the search term and result count.

## Gotchas

- Home redirects to `/profiles` when `cflix_profile` is unset.
- Progress posts from the player screen feed continue watching; a fresh server has an empty `#row-continue`.
- Search results replace `#row-results` content; the wrap stays visible until the page reloads.
- The search expectations assume an adult/teen-visible profile. A child profile filters out both teen seed items (`The Dark Knight`, `Dark` — both `maturity: 'teen'` in `server/src/catalog-data.js`), so `dark` returns 0 cards there. Filtering is `maturityAllowed` (`server/src/types.js` lines 1-5, rank `child: 0, teen: 1, adult: 2`) applied in `server/src/catalog.js`. Select an adult profile before asserting the two-card result.
