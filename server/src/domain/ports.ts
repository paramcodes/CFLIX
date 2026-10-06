/**
 * Domain Repository and Service Ports for CFLIX.
 *
 * In Hexagonal Architecture (Ports & Adapters), the core domain defines
 * abstract interfaces describing the operations it requires.
 * Infrastructure adapters (Drizzle SQLite, Redis, Google OIDC) implement these ports.
 */

// ------------------------------------------------------------------ Branded Types

declare const AccountIdBrand: unique symbol;
declare const ProfileIdBrand: unique symbol;
declare const MediaIdBrand: unique symbol;

export type AccountId = string & { readonly [AccountIdBrand]: true };
export type ProfileId = string & { readonly [ProfileIdBrand]: true };
export type MediaId = string & { readonly [MediaIdBrand]: true };

export type Maturity = 'child' | 'teen' | 'adult';
export type MediaKind = 'movie' | 'series' | 'anime';

// ------------------------------------------------------------------ Domain Entities

export interface AccountEntity {
  id: string;
  email: string;
  provider: 'email' | 'google';
  passwordHash: string | null;
}

export interface SessionEntity {
  token: string;
  accountId: string;
  expiresAt: number;
}

export interface ProfileEntity {
  id: string;
  accountId: string;
  name: string;
  maturity: Maturity;
}

export interface ProgressEntity {
  id: string;
  profileId: string;
  itemId: string;
  seconds: number;
  updatedAt: string;
}

export interface CatalogItemEntity {
  kind: 'movie' | 'series';
  id: string;
  title: string;
  synopsis: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  year: number | null;
  durationSeconds: number | null;
  maturity: Maturity;
  genres: string[];
  cast: string[];
  rating: number | null;
  trailerYtId: string | null;
  provider: string;
  seasonCount?: number;
  episodes?: EpisodeEntity[];
  source?: 'provider' | 'seed';
}

export interface EpisodeEntity {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  durationSeconds: number;
  synopsis: string | null;
  stillUrl: string | null;
}

// ------------------------------------------------------------------ Identity Provider Port

export interface IdentityProviderPort {
  verifyToken(
    idToken: string,
  ): Promise<{ email: string; providerUserId?: string }>;
}

// ------------------------------------------------------------------ Information Retrieval Ports

export interface SearchIndexPort {
  search(
    query: string,
    items: CatalogItemEntity[],
    options?: { kind?: string | null; limit?: number },
  ): Promise<CatalogItemEntity[]>;
}

export interface RecommendationEnginePort {
  recommendRelated(
    anchor: CatalogItemEntity,
    pool: CatalogItemEntity[],
    options?: { limit?: number },
  ): Promise<CatalogItemEntity[]>;
}

// ------------------------------------------------------------------ Enterprise Media & Gateway Ports

export interface SubtitleTrack {
  id: string;
  language: string; // ISO 639-1 ('en', 'es', 'ja')
  label: string;
  kind: 'subtitles' | 'captions' | 'forced-narrative';
  src: string;
}

export interface AudioTrack {
  id: string;
  language: string;
  label: string;
  channels: 'stereo' | '5.1' | 'spatial';
  isAudioDescription: boolean;
}

export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

export interface SpatialBox {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SpatialNavigationPort {
  findNextFocus(
    currentId: string,
    direction: SpatialDirection,
    candidates: SpatialBox[],
  ): string | null;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiterPort {
  checkLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): RateLimitResult;
}
// ------------------------------------------------------------------ Repository Ports

export interface AccountRepositoryPort {
  findByEmail(email: string): AccountEntity | null;
  findById(id: string): AccountEntity | null;
  save(account: AccountEntity): void;
  listAll(): AccountEntity[];
}

export interface SessionRepositoryPort {
  findByToken(token: string): SessionEntity | null;
  save(session: SessionEntity): void;
  delete(token: string): void;
}

export interface ProfileRepositoryPort {
  listByAccountId(accountId: string): ProfileEntity[];
  findById(id: string): ProfileEntity | null;
  save(profile: ProfileEntity): void;
  delete(id: string): void;
  listAll(): ProfileEntity[];
}

export interface ProgressRepositoryPort {
  listByProfileId(profileId: string): ProgressEntity[];
  findByItem(profileId: string, itemId: string): ProgressEntity | null;
  save(progress: ProgressEntity): void;
  listAll(): ProgressEntity[];
}

// ------------------------------------------------------------------ Service Ports

export interface AuthServicePort {
  signUp(input: { email: string; password: string }): {
    user: { id: string; email: string; provider: string };
    session: { token: string; expiresAt: number };
  };
  signIn(input: { email: string; password: string }): {
    user: { id: string; email: string; provider: string };
    session: { token: string; expiresAt: number };
  };
  signInWithGoogle(input: { idToken: string }): {
    user: { id: string; email: string; provider: string };
    session: { token: string; expiresAt: number };
  };
  signOut(token: string | null): void;
  accountForToken(token: string): AccountEntity;
}

export interface ProfileServicePort {
  list(accountId: string): ProfileEntity[];
  create(
    accountId: string,
    input: { name: string; maturity?: Maturity },
  ): ProfileEntity;
  update(
    accountId: string,
    id: string,
    patch: Partial<ProfileEntity>,
  ): ProfileEntity;
  remove(accountId: string, id: string): void;
}

export interface CatalogServicePort {
  browse(
    profileId: string | null,
    kind: string | null,
    options?: { genre?: string | null },
  ): Promise<{ items: CatalogItemEntity[] }>;
  get(profileId: string | null, id: string): Promise<CatalogItemEntity>;
  related(
    profileId: string | null,
    id: string,
  ): Promise<{ items: CatalogItemEntity[] }>;
  search(
    profileId: string | null,
    query: {
      text: string;
      kind?: string | null;
      cursor?: string | null;
      limit?: number;
    },
  ): Promise<{ items: CatalogItemEntity[]; nextCursor: string | null }>;
  play(
    accountId: string,
    profileId: string | null,
    ref: { id: string; kind?: string },
  ): Promise<{
    item: CatalogItemEntity | EpisodeEntity;
    manifestUrl?: string;
    resumeFromSeconds: number;
  }>;
  recordProgress(
    profileId: string | null,
    entry: { itemId: string; seconds: number },
  ): ProgressEntity;
  history(
    profileId: string | null,
    options?: { limit?: number },
  ): Promise<Array<ProgressEntity & { item: CatalogItemEntity | null }>>;
}
