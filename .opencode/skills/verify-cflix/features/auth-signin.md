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
- **Google stub.** `page.click('#btn-google')` triggers `prompt()`; answer it with the BARE email (the page prefixes `google:` itself when building the idToken, `public/js/pages/signin.js:44`). Redirect to `/profiles`.
- **Proof.** Screenshot the profiles page after sign-in and record the redirect target. Save under `artifacts/verify-cflix/`.

## Gotchas

- After a successful sign-in, `cflix_profile` is cleared; the profiles page redirects to sign-in again if the token is missing.
- The Google button uses `prompt()`. Playwright auto-dismisses unhandled dialogs, and the handler bails on an empty answer (`if (!email) return;`, `public/js/pages/signin.js:39`), so an unhandled click no-ops: no navigation, no error. Answer the dialog, or the step silently does nothing rather than hanging.
- Errors render into `#in-error`, not a toast or alert; assert on that element's text.
- Google login clears `cflix_profile` exactly like sign-in and sign-up (`public/js/pages/signin.js:46-47` sets `ses.token` and `ses.profile = null`), so the profile picker is clean afterwards. This file previously recorded it as an open product gap citing `public/wire.js` line numbers; that code was split into per-page modules and the gap was fixed in PR #43.
- The Google stub account is keyed `google:<email>`, so answering the prompt with a constant email reuses one account across runs and inherits every profile earlier runs left on it. Use a timestamped email per run, or a fresh-account assertion after Google login will see stale tiles.
