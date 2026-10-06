import { z } from 'zod';
import { DomainError } from './errors.js';
import type {
  AccountId,
  ProfileId,
  MediaId,
  Maturity,
  MediaKind,
} from './domain/ports.js';

/**
 * Anti-Corruption Layer (ACL) and Parse Boundary for CFLIX.
 *
 * Implemented with Zod schema validation. Validates untrusted external inputs
 * (request bodies, query params, headers) at the system perimeter before they
 * reach internal domain services or catalog routers.
 */

const VALID_KINDS: Record<string, true> = {
  movie: true,
  series: true,
  anime: true,
};

function parseWithZod<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  customErrorMessage?: string,
): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message =
      customErrorMessage || firstIssue?.message || 'Validation failed';
    throw new DomainError('VALIDATION', message);
  }
  return result.data;
}

/**
 * Brand a verified string as a domain ID.
 */
export function brandId<T extends string>(value: string): T {
  return value as unknown as T;
}

// ------------------------------------------------------------------ Zod Schemas

export const SignUpSchema = z.object({
  email: z
    .string()
    .min(3, 'email must be a valid email address')
    .refine((s) => s.includes('@') && !s.startsWith('@') && !s.endsWith('@'), {
      message: 'email must be a valid email address',
    })
    .transform((s) => s.toLowerCase()),
  password: z.string().min(1, 'password must not be empty'),
});

export const SignInSchema = z.object({
  email: z.string().min(1, 'email must not be empty'),
  password: z.string().min(1, 'password must not be empty'),
});

export const GoogleAuthSchema = z.object({
  idToken: z.string().min(1, 'idToken must not be empty'),
});

export const CreateProfileSchema = z.object({
  name: z
    .string()
    .min(1, 'name must not be empty')
    .max(50, 'name exceeds maximum length of 50')
    .transform((s) => s.trim()),
  maturity: z.enum(['child', 'teen', 'adult']).optional(),
});

export const SearchBodySchema = z.object({
  text: z
    .string()
    .default('')
    .transform((s) => s.trim()),
  kind: z.enum(['movie', 'series', 'anime']).nullable().optional(),
  cursor: z.string().nullable().optional(),
  limit: z.number().int().positive().default(20),
});
export const PlayBodySchema = z.object({
  ref: z.object({
    id: z
      .string()
      .min(1, 'unknown media kind')
      .transform((s) => s.trim()),
    kind: z.string().optional(),
  }),
});
export const ProgressBodySchema = z.object({
  itemId: z.string().min(1, 'itemId must not be empty'),
  seconds: z.number().min(0).default(0),
});

// ------------------------------------------------------------------ Inferred DTO Types

export type SignUpDto = z.infer<typeof SignUpSchema>;
export type SignInDto = z.infer<typeof SignInSchema>;
export type GoogleAuthDto = z.infer<typeof GoogleAuthSchema>;
export type CreateProfileDto = z.infer<typeof CreateProfileSchema>;
export type SearchBodyDto = z.infer<typeof SearchBodySchema>;
export type PlayBodyDto = z.infer<typeof PlayBodySchema>;
export type ProgressBodyDto = z.infer<typeof ProgressBodySchema>;

// ------------------------------------------------------------------ Boundary Facade

export const Boundary = {
  parseSignUp(raw: unknown): SignUpDto {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DomainError('VALIDATION', 'body must be a non-null object');
    }
    return parseWithZod(SignUpSchema, raw);
  },

  parseSignIn(raw: unknown): SignInDto {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DomainError('VALIDATION', 'body must be a non-null object');
    }
    return parseWithZod(SignInSchema, raw);
  },

  parseGoogleAuth(raw: unknown): GoogleAuthDto {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DomainError('VALIDATION', 'body must be a non-null object');
    }
    return parseWithZod(GoogleAuthSchema, raw);
  },

  parseCreateProfile(raw: unknown): CreateProfileDto {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DomainError('VALIDATION', 'body must be a non-null object');
    }
    return parseWithZod(CreateProfileSchema, raw);
  },

  parseBrowseQuery(url: URL): { kind: MediaKind | null; genre: string | null } {
    const rawKind = url.searchParams.get('kind');
    const rawGenre = url.searchParams.get('genre');
    const kind = rawKind ? rawKind.toLowerCase().trim() : null;
    if (kind && !VALID_KINDS[kind]) {
      throw new DomainError('VALIDATION', `unknown kind: ${rawKind}`);
    }
    return {
      kind: kind as MediaKind | null,
      genre: rawGenre ? rawGenre.toLowerCase().trim() : null,
    };
  },

  parseGetQuery(url: URL): { id: MediaId } {
    const id = url.searchParams.get('id');
    if (!id || !id.trim()) {
      throw new DomainError('VALIDATION', 'id parameter is required');
    }
    return { id: brandId<MediaId>(id.trim()) };
  },

  parseSearchBody(raw: unknown): SearchBodyDto {
    const candidate: Record<string, unknown> =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const rawKind =
      typeof candidate.kind === 'string'
        ? candidate.kind.toLowerCase().trim()
        : null;
    if (rawKind && !VALID_KINDS[rawKind]) {
      throw new DomainError(
        'VALIDATION',
        `unknown search kind: ${String(candidate.kind)}`,
      );
    }

    return parseWithZod(SearchBodySchema, raw || {});
  },

  parsePlayBody(raw: unknown): { ref: { id: MediaId; kind?: string } } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DomainError('VALIDATION', 'unknown media kind');
    }
    const data = parseWithZod(PlayBodySchema, raw, 'unknown media kind');
    return {
      ref: {
        id: brandId<MediaId>(data.ref.id),
        kind: data.ref.kind
          ? String(data.ref.kind).toLowerCase().trim()
          : undefined,
      },
    };
  },

  parseProgressBody(raw: unknown): { itemId: MediaId; seconds: number } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DomainError('VALIDATION', 'body must be a non-null object');
    }
    const data = parseWithZod(ProgressBodySchema, raw);
    return {
      itemId: brandId<MediaId>(data.itemId),
      seconds: data.seconds,
    };
  },

  parseProfileHeader(raw: unknown): ProfileId | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed ? brandId<ProfileId>(trimmed) : null;
  },
};
