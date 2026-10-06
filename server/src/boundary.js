import { z } from 'zod';
import { DomainError } from './errors.js';

/**
 * Anti-Corruption Layer (ACL) and Parse Boundary for CFLIX.
 *
 * Implemented with Zod schema validation. Validates untrusted external inputs
 * (request bodies, query params, headers) at the system perimeter before they
 * reach internal domain services or catalog routers.
 *
 * Enforces:
 *   1. Declarative shape & type validation via Zod schemas.
 *   2. Rejection of malformed data with DomainError('VALIDATION', ...).
 *   3. Domain ID branding (AccountId, ProfileId, MediaId).
 */

/**
 * @typedef {string & { readonly __brand: 'AccountId' }} AccountId
 * @typedef {string & { readonly __brand: 'ProfileId' }} ProfileId
 * @typedef {string & { readonly __brand: 'MediaId' }} MediaId
 * @typedef {'child' | 'teen' | 'adult'} Maturity
 */

function validationError(message) {
  return new DomainError('VALIDATION', message);
}

function parseWithZod(schema, raw, customErrorMessage) {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message =
      customErrorMessage || firstIssue?.message || 'Validation failed';
    throw validationError(message);
  }
  return result.data;
}

/**
 * Brand a verified string as a domain ID.
 * @template {string} B
 * @param {string} value
 * @param {B} _brand
 * @returns {string & { readonly __brand: B }}
 */
export function brandId(value, _brand) {
  return /** @type {any} */ (String(value));
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
  ref: z.object(
    {
      id: z
        .string()
        .min(1, 'unknown media kind')
        .transform((s) => s.trim()),
      kind: z.string().optional(),
    },
    {
      required_error: 'unknown media kind',
      invalid_type_error: 'unknown media kind',
    },
  ),
});

export const ProgressBodySchema = z.object({
  itemId: z.string().min(1, 'itemId must not be empty'),
  seconds: z.number().min(0).default(0),
});

// ------------------------------------------------------------------ Boundary Facade

export const Boundary = {
  /**
   * Parse and validate POST /api/auth/signup payload.
   */
  parseSignUp(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError('body must be a non-null object');
    }
    return parseWithZod(SignUpSchema, raw);
  },

  /**
   * Parse and validate POST /api/auth/signin payload.
   */
  parseSignIn(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError('body must be a non-null object');
    }
    return parseWithZod(SignInSchema, raw);
  },

  /**
   * Parse and validate POST /api/auth/google payload.
   */
  parseGoogleAuth(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError('body must be a non-null object');
    }
    return parseWithZod(GoogleAuthSchema, raw);
  },

  /**
   * Parse and validate POST /api/profiles payload.
   */
  parseCreateProfile(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError('body must be a non-null object');
    }
    return parseWithZod(CreateProfileSchema, raw);
  },

  /**
   * Parse and validate GET /api/catalog/browse query params.
   */
  parseBrowseQuery(url) {
    const rawKind = url.searchParams.get('kind');
    const rawGenre = url.searchParams.get('genre');
    const kind = rawKind ? rawKind.toLowerCase().trim() : null;
    const VALID_KINDS = new Set(['movie', 'series', 'anime']);
    if (kind && !VALID_KINDS.has(kind)) {
      throw validationError(`unknown kind: ${rawKind}`);
    }
    return {
      kind,
      genre: rawGenre ? rawGenre.toLowerCase().trim() : null,
    };
  },

  /**
   * Parse and validate GET /api/catalog/get and /api/catalog/related query params.
   */
  parseGetQuery(url) {
    const id = url.searchParams.get('id');
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw validationError('id parameter is required');
    }
    return { id: brandId(id.trim(), 'MediaId') };
  },

  /**
   * Parse and validate POST /api/catalog/search body.
   */
  parseSearchBody(raw) {
    const body = raw && typeof raw === 'object' ? raw : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const rawKind = body.kind ? String(body.kind).toLowerCase().trim() : null;
    const VALID_KINDS = new Set(['movie', 'series', 'anime']);
    if (rawKind && !VALID_KINDS.has(rawKind)) {
      throw validationError(`unknown search kind: ${body.kind}`);
    }
    const cursor = body.cursor != null ? String(body.cursor).trim() : null;
    const limit =
      Number.isInteger(body.limit) && body.limit > 0 ? body.limit : 20;
    return { text, kind: rawKind, cursor, limit };
  },

  /**
   * Parse and validate POST /api/play body.
   */
  parsePlayBody(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError('unknown media kind');
    }
    const data = parseWithZod(PlayBodySchema, raw, 'unknown media kind');
    return {
      ref: {
        id: brandId(data.ref.id, 'MediaId'),
        kind: data.ref.kind
          ? String(data.ref.kind).toLowerCase().trim()
          : undefined,
      },
    };
  },

  /**
   * Parse and validate POST /api/progress body.
   */
  parseProgressBody(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw validationError('body must be a non-null object');
    }
    const data = parseWithZod(ProgressBodySchema, raw);
    return {
      itemId: brandId(data.itemId, 'MediaId'),
      seconds: data.seconds,
    };
  },

  /**
   * Parse and validate x-cflix-profile header.
   */
  parseProfileHeader(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed ? brandId(trimmed, 'ProfileId') : null;
  },
};
