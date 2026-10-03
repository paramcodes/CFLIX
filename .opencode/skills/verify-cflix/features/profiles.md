# Profile selection

The profiles screen lists the account's profiles as avatar tiles, lets the user add one with a name and maturity, and choosing a tile enters that profile's home screen.

## Sub-features

- `profile-list` renders one tile per profile.
- `profile-create` adds a profile via the dialog and shows it in the list.
- `profile-select` stores the chosen profile and opens the home screen.
- `profile-create-empty-name` blocks creation and shows a validation error.

## How to get to it (user POV)

- Redirected here after successful sign-in.
- "Switch profile" on the home screen returns here with `cflix_profile` cleared.

## Driving it with Playwright

Preconditions:

- Signed in: `sessionStorage.cflix_token` is set (run the auth-signin recipe first).
- Open `/profiles.html`.

- **List.** Tiles appear. Run `await page.locator('#profile-list .avatar-tile[data-id]').count()`. Count matches the profiles returned by `GET /api/profiles`.
- **Create.** Open the dialog and submit. Run `page.click('#add-profile')`, `page.fill('#dlg-name', 'Kid')`, `page.click('#dlg-maturity button[data-m="child"]')`, `page.click('#dlg-create')`. The dialog closes and a new tile with `Kid · child` appears.
- **Empty name.** Open the dialog, leave `#dlg-name` blank, click `#dlg-create`. `#dlg-error` reads `Name is required.`; no tile is added.
- **Select.** Click a tile. Run `page.click('#profile-list .avatar-tile[data-id]').first()`. URL becomes `screens/05-home-page.html`, `#who` reads `Watching as <name>`, and `sessionStorage.cflix_profile` holds `{id, name}`.
- **Proof.** Screenshot the profiles list and the home screen after selection; record `#who` text.

## Gotchas

- If there is no valid token, the page redirects to `screens/02-sign-in.html`; sign in first.
- Maturity defaults to `adult` in the dialog; click the segment button to change it before creating.
- Profile creation requires a name; clicking create with an empty name only shows the inline error.
