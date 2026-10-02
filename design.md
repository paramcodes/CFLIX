# CFLIX — design sketch (types and signatures)

Stack for the sketch: TypeScript. One client library (`@cflix/client`) for web/mobile callers,
and a server behind it exposing three services. Wire DTOs never appear on the public surface.

## Usage (caller's view)

```ts
import { createCFlix } from '@cflix/client';

const cflix = createCFlix({ apiUrl: 'https://api.cflix.example' });

// Sign up with email+password, or Google.
const account = await cflix.signUp({ email, password });
const account2 = await cflix.signInWithGoogle(googleIdToken);

// Pick who is watching. Everything after this is scoped to that profile.
const profiles = await account.listProfiles();
const session = await account.selectProfile(profiles[0].id);

// Search, then play.
const page = await session.search('dark', { kind: 'series' });
const playback = await session.play(page.items[0]);
player.load(playback.manifestUrl, { startAtSeconds: playback.resumeFromSeconds });
setInterval(() => playback.reportPosition(player.positionSeconds), 10_000);
```

```ts
// App launch: restore whatever the server remembers.
const restored = await cflix.resumeSession();
if (restored?.kind === 'viewing') showHome(restored);
else if (restored) showProfilePicker(restored);
else showSignIn();
```

Errors reject promises with a `CFlixError` union; callers narrow on `err.kind`.

## Types

```ts
// Branded ids. Only the parse layer can construct them.
type Brand<Base, B> = Base & { readonly __brand: B };
export type AccountId = Brand<string, 'AccountId'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type MovieId   = Brand<string, 'MovieId'>;
export type SeriesId  = Brand<string, 'SeriesId'>;
export type EpisodeId = Brand<string, 'EpisodeId'>;

export type Maturity = 'child' | 'teen' | 'adult';

export interface AccountInfo {
  id: AccountId;
  email: string;
  provider: 'email' | 'google';
}

export interface Profile {
  id: ProfileId;
  accountId: AccountId; // ownership on the type
  name: string;         // non-empty by constructor
  maturity: Maturity;
}

// A movie is complete in every context.
export interface Movie {
  kind: 'movie';
  id: MovieId;
  title: string;
  synopsis: string;
  posterUrl: string;
  year: number;
  durationSeconds: number;
  maturity: Maturity;
}

// Card-level series. No `seasons` field, so a listing is never
// mistaken for a hydrated series.
export interface SeriesListing {
  kind: 'series';
  id: SeriesId;
  title: string;
  synopsis: string;
  posterUrl: string;
  year: number;
  seasonCount: number;
  maturity: Maturity;
}

// Detail-level series. Only from session.series(id).
export interface Series {
  kind: 'series';
  id: SeriesId;
  title: string;
  synopsis: string;
  posterUrl: string;
  year: number;
  seasons: Season[]; // >= 1 by constructor
  maturity: Maturity;
}

export interface Season {
  seasonNumber: number;
  episodes: Episode[];
}

export interface Episode {
  id: EpisodeId;
  seriesId: SeriesId;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  durationSeconds: number;
}

export type CatalogItem = Movie | SeriesListing;

// Anything play() accepts. Every content type structurally satisfies a variant.
export type MediaRef =
  | { kind: 'movie'; id: MovieId }
  | { kind: 'series'; id: SeriesId }
  | { kind: 'episode'; id: EpisodeId };

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface WatchPosition {
  profileId: ProfileId;
  itemId: MovieId | SeriesId | EpisodeId;
  seconds: number;
  updatedAt: Date;
}

export type CFlixError =
  | { kind: 'invalid-credentials' }
  | { kind: 'email-already-registered' }
  | { kind: 'profile-limit-reached' }
  | { kind: 'not-found' }
  | { kind: 'maturity-blocked' }
  | { kind: 'session-expired' }
  | { kind: 'network-unavailable' };
```

## Client signatures (app-facing)

```ts
export interface CFlix {
  signUp(input: { email: string; password: string }): Promise<AccountSession>;
  signInWithPassword(input: { email: string; password: string }): Promise<AccountSession>;
  signInWithGoogle(idToken: string): Promise<AccountSession>;
  resumeSession(): Promise<AccountSession | ViewingSession | null>;
}
export function createCFlix(config: { apiUrl: string; tokenStore?: TokenStore }): CFlix;

// After auth, before profile selection. No catalog calls exist on this type.
export interface AccountSession {
  kind: 'account';
  account: AccountInfo;
  listProfiles(): Promise<Profile[]>;
  createProfile(input: { name: string; maturity: Maturity }): Promise<Profile>;
  selectProfile(profileId: ProfileId): Promise<ViewingSession>;
  signOut(): Promise<void>; // idempotent
}

// All browse, search, and playback calls. Scoped to one profile.
export interface ViewingSession {
  kind: 'viewing';
  account: AccountInfo;
  profile: Profile;

  browseMovies(cursor?: string): Promise<Page<Movie>>;
  browseSeries(cursor?: string): Promise<Page<SeriesListing>>;
  search(query: string, opts?: { kind?: 'movie' | 'series'; cursor?: string }): Promise<Page<CatalogItem>>;
  movie(id: MovieId): Promise<Movie>;
  series(id: SeriesId): Promise<Series>;

  // Movie/episode ref: plays it. Series ref: server picks the profile's
  // next unwatched episode and plays that.
  play(item: MediaRef): Promise<Playback>;

  history(opts?: { limit?: number }): Promise<WatchPosition[]>;
  recordProgress(entry: { itemId: MovieId | SeriesId | EpisodeId; seconds: number }): Promise<void>;

  switchProfile(profileId: ProfileId): Promise<ViewingSession>;
  signOut(): Promise<void>;
}

export interface Playback {
  readonly item: Movie | Episode; // resolved item, for "S2 E4" display
  readonly manifestUrl: string;   // HLS/DASH
  readonly resumeFromSeconds: number;
  reportPosition(seconds: number): Promise<void>; // absolute, retry-safe
  finish(): Promise<void>; // idempotent
}
```

## Server signatures (behind the client)

```ts
export interface AuthService {
  signUp(input: { email: string; password: string }): Promise<{ user: AccountInfo; session: Session }>;
  signIn(input: { email: string; password: string }): Promise<{ user: AccountInfo; session: Session }>;
  signInWithGoogle(input: { idToken: string }): Promise<{ user: AccountInfo; session: Session }>;
  refresh(refreshToken: string): Promise<Session>;
  signOut(refreshToken: string): Promise<void>;
}

export interface ProfileService {
  list(user: AccountId): Promise<Profile[]>;
  create(user: AccountId, input: { name: string; maturity: Maturity }): Promise<Profile>;
  update(user: AccountId, id: ProfileId, input: { name?: string; maturity?: Maturity }): Promise<Profile>;
  remove(user: AccountId, id: ProfileId): Promise<void>;
}

export interface CatalogService {
  home(profile: ProfileId): Promise<{ rows: { key: string; title: string; items: CatalogItem[] }[] }>;
  get(id: MovieId | SeriesId): Promise<Movie | Series>;
  search(profile: ProfileId, q: { text: string; kind?: 'movie' | 'series'; cursor?: string }): Promise<Page<CatalogItem>>;
  play(user: AccountId, profile: ProfileId, ref: MediaRef): Promise<{ item: Movie | Episode; manifestUrl: string; resumeFromSeconds: number }>;
  recordProgress(profile: ProfileId, entry: { itemId: MovieId | SeriesId | EpisodeId; seconds: number }): Promise<void>;
  history(profile: ProfileId, opts?: { limit?: number }): Promise<WatchPosition[]>;
}
```

## Module map

```
src/
  index.ts          public re-exports only
  client.ts         CFlix, createCFlix, TokenStore
  session.ts        AccountSession, ViewingSession
  playback.ts       Playback
  types.ts          domain types, branded ids, Page, CFlixError
  internal/
    api.ts          HTTP transport, token attach, 401 -> session-expired
    parse.ts        wire JSON -> domain types; only validation layer
server/
  domain/           types + DomainError; no imports
  services/         AuthService, ProfileService, CatalogService
  http/             thin adapter: body validation, wire DTOs, error mapping
  adapters/         Postgres repos, Google JWKS verify, search index, stream signer
```

Dependency direction: `http` -> `services` -> `domain`; `adapters` implement service ports.
The client's session methods and the server's services share the `types.ts` shape; wire
parsing lives only in `internal/parse.ts` and `server/http`.

## Rationale

### Problem

CFLIX needs auth (email+password, Google), multiple profiles per account, movies/series,
search, and playback. The non-obvious part is the profile gate: every content call is scoped
to one active profile, but profile selection happens after auth and can change mid-session.
A design exposing auth and profile plumbing gives every screen a chance to call the catalog
with no profile or the wrong one. Maturity filtering (child profiles must not see adult
titles) is a cross-cutting policy that should live in one place.

### Usage (caller's view)

The quickstart above is the spec. Two sessions (`AccountSession`, `ViewingSession`) exist
because the two real states of the app (signed in, viewing) are two types, so calling
`search` before profile selection does not compile (per type-system-discipline). `play`
takes a `MediaRef` union because a caller holding a `SeriesListing` can pass it directly;
the sketch was reconciled to that call site.

### Shape

`AccountSession` owns profiles and nothing else. `selectProfile` hands off to
`ViewingSession`, a flat facade with browse, search, detail, play, history, switch, signOut.
No sub-facets: `session.catalog.movies()` would hold the same token and profile the session
already holds, adding a layer without hiding complexity (per minimize-reader-load).

`Movie` is full-formed everywhere; `SeriesListing` (cards/search) and `Series` (detail)
are two types instead of one optional `seasons?` field, so the half-hydrated series state is
unrepresentable (per foundational-thinking, tracing the card grid vs detail access patterns).

`play` hides policy: for a series ref, the server picks the profile's next unwatched episode
and the resolved `Playback.item` tells the UI what was chosen. Progress reports are absolute
positions, idempotent upserts keyed by `(profileId, itemId)`; two devices merge
latest-timestamp-wins at the read boundary, so per-profile state never needs a lock (per
separate-before-serializing-shared-state, make-operations-idempotent).

All wire validation happens at one boundary per side: `internal/parse.ts` on the client,
`server/http` on the server (per boundary-discipline). Branded ids are constructible only at
those boundaries, so an unvalidated id cannot enter the domain.

Server services hide credentials, Google token verification, search indexing, and stream
signing behind 15 methods total. Payments, recommendations, and admin CMS attach later at
`CatalogService.play`, the search adapter, and a new admin router respectively, with no
change to the client surface.

### Synthesis decision

Base: candidate 3 (session/facade client). It has the smallest public surface and makes the
profile gate a type error.

Grafted from candidate 1: `Profile.accountId` and `maturity` on every profile,
`WatchPosition` keyed by `(profileId, itemId)`, and mixed movie/series history. Candidate 1's
flat `watch.*` verbs collapse into `ViewingSession.history`/`recordProgress`.

Grafted from candidate 2: the three server services (`AuthService`, `ProfileService`,
`CatalogService`) as the seam the client sits on, and the HTTP conventions (cursor pages,
ISO 8601, stable error codes). Candidate 2's `Profile { kids: boolean }` was replaced by
`maturity` to cover teen as a third state.

Rejected: candidate 1's free-floating `catalog`/`watch` objects called with raw ids (callers
can hit the catalog with no profile or wrong profile); candidate 2's per-call `profile`
parameter threading (the facade carries it once); candidate 3's `kids` flag reduced to a
boolean (maturity is the better domain shape); candidate 2's full `Title`/`TitleSummary`
split (collapsed into `Movie`/`SeriesListing`/`Series` for series only, since movies have no
children to hydrate).

### Tradeoffs accepted

- Two session types and a union at `resumeSession`, in exchange for making unprofiled content calls a compile error.
- `play(series)` hides episode selection as server policy, in exchange for one-call playback. Explicit choice stays available via `session.series(id)`.
- Last-writer-wins on cross-device progress, in exchange for zero client coordination.
- `maturity` on every content type, in exchange for filtering without a second lookup.
- `recordProgress` idempotent upsert, losing "most-progressed-wins" merging.

### Alternatives considered

- Service-per-domain client (`AuthService`, `CatalogService`, `PlaybackService` with token/profile passed per call). Lost: exposes the active-profile rule to every call site and makes the no-profile state reachable. Shallower interface, wider surface.
- One `Session` type with `activeProfile: Profile | null` and runtime guards. Lost: every content method gains a `'no-profile-selected'` failure mode that the type split deletes for free.
- Single `CatalogItem` type with optional `seasons`. Lost: admits half-hydrated listings and forces every consumer to check.
- GraphQL domain-graph schema. Lost: domain graph becomes the public contract; every schema change is breaking for every screen.

### Open questions and risks

- Where does maturity enforcement live: inside `CatalogService.search`/`play` (domain invariant) or only in the UI? The sketch assumes inside the services.
- Does sign-up require email verification? If yes, `signUp` needs a pending state instead of returning `AccountSession`.
- Google account merge: same email via password and Google, one account or two?
- Concurrent stream limits per account: sketched as no cap; add a `stream-limit-reached` error and a check inside `CatalogService.play` if plans cap streams.
- Does cold start force the profile picker (Netflix-style), or remember the last profile (`resumeSession` returning `ViewingSession`)? Product call.

### Next implementation step

Build the auth-to-profile handoff end to end: `signInWithPassword`, `selectProfile`,
`resumeSession`, with `internal/parse.ts` and a stub catalog. Every later feature hangs off
`ViewingSession` existing, so that scaffold comes first.
