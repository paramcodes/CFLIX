# Sign in and sign up

The sign-in screen lets a new or returning user get an account session: email+password sign-up, email+password sign-in, or a Google stub. Success redirects to the profile picker; failure shows an inline error.

## Sub-features

- `signin-ok` signs in with valid credentials and lands on profiles.
- `signin-bad` shows an inline error for a wrong password.
- `signup-ok` creates an account and lands on profiles.
- `google-stub` signs in via the `google:<email>` idToken prompt and lands on profiles.

## How to get to it (user POV)

- Open `/signin` directly.
- Follow the redirect from `/profiles` when signed out.
- The landing page's "Sign In" CTA links to this screen.

## Driving it with Playwright

Preconditions:

- CFLIX is healthy per the Doctor checks.
- Store is fresh (restarted server) unless testing sign-in on an existing account.

- **Sign up.** Fill a new email and password, choose Sign Up. Run `page.fill('#in-email', 'new@test.dev')`, `page.fill('#in-password', 'pw123456')`, `page.click('#btn-signup')`. The browser lands on `/profiles` and `sessionStorage.cflix_token` is set.
- **Sign in.** Fill the same credentials, choose Sign In. Run `page.fill('#in-email', 'new@test.dev')`, `page.fill('#in-password', 'pw123456')`, `page.click('#btn-signin')`. Redirect to `/profiles`.
- **Bad password.** Run `page.fill('#in-email', 'new@test.dev')`, `page.fill('#in-password', 'wrong')`, `page.click('#btn-signin')`. `#in-error` shows an error message; the URL is unchanged.
- **Google stub.** `page.click('#btn-google')` triggers `prompt()`; answer it with the BARE email (the page prefixes `google:` itself when building the idToken, `public/wire.js` lines 77-83). Redirect to `/profiles`.
- **Proof.** Screenshot the profiles page after sign-in and record the redirect target. Save under `artifacts/verify-cflix/`.

## Gotchas

- After a successful sign-in, `cflix_profile` is cleared; the profiles page redirects to sign-in again if the token is missing.
- The Google button uses `prompt()`; Playwright must handle the dialog or the click hangs.
- Errors render into `#in-error`, not a toast or alert; assert on that element's text.
- Google login does NOT clear `cflix_profile`: sign-in/sign-up set `ses.profile = null` (`public/wire.js` lines 56, 70) but the google handler sets only `ses.token` (line 85). A profile from a previous account survives under the new google token; proven live by `/tmp/opencode/p7/drive.log` STALE-PROFILE-CHECK (`{"id":"p_2","name":"Kid"}` before and after). This is a product gap, reported not fixed here; recipes that assume a clean profile picker after Google login must clear `cflix_profile` first.
