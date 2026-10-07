# Sign in and sign up

The sign-in screen lets a new or returning user get an account session: email+password sign-up or email+password sign-in. Success redirects to the profile picker; failure shows an inline error.

## Sub-features

- `signin-ok` signs in with valid credentials and lands on profiles.
- `signin-bad` shows an inline error for a wrong password.
- `signup-ok` creates an account and lands on profiles.

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
- **Only one form.** The card carries exactly one email box, one password box and one submit button, and nothing on it opens a dialog. Count those rather than assuming a third sign-in option exists.
- **Proof.** Screenshot the profiles page after sign-in and record the redirect target. Save under `artifacts/verify-cflix/`.

## Gotchas

- After a successful sign-in, `cflix_profile` is cleared; the profiles page redirects to sign-in again if the token is missing.
- Errors render into `#in-error`, not a toast or alert; assert on that element's text.
- Sign-in and sign-up both clear `cflix_profile` by setting `ses.token` and `ses.profile = null` in the `signin` page module, so the profile picker is clean afterwards. This file previously recorded that as an open product gap citing `public/wire.js` line numbers; that code was split into per-page modules and the gap was fixed in PR #43.
- There is no Google control and no `prompt()` on this screen. A flow that waits for a dialog will hang forever rather than fail, so drive the flow through `#btn-signup` and `#btn-signin`.
