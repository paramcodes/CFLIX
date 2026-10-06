import { DomainError } from './errors.js';

/**
 * Anti-Corruption Layer (ACL) and Parse Boundary for CFLIX.
 *
 * Validates untrusted external inputs (request bodies, query params, headers)
 * at the system perimeter before they can reach domain services or catalog routers.
 *
 * Enforces:
 *   1. Shape & type validation on all inbound wire envelopes.
 *   2. Rejection of malformed data with DomainError('VALIDATION', ...).
 *   3. Domain ID branding (AccountId, ProfileId, MovieId, SeriesId, EpisodeId).
 */

/**
 * @typedef {string & { readonly __brand: 'AccountId' }} AccountId
 * @typedef {string & { readonly __brand: 'ProfileId' }} ProfileId
 * @typedef {string & { readonly __brand: 'MediaId' }} MediaId
 * @typedef {'child' | 'teen' | 'adult'} Maturity
 */

const VALID_MATURITIES = new Set(['child', 'teen', 'adult']);
const VALID_KINDS = new Set(['movie', 'series', 'anime']);

function validationError(message) {
  return new DomainError('VALIDATION', message);
}

function assertObject(value, name = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${name} must be a non-null object`);
  }
  return value;
}

function assertString(value, name, { min = 1, max = 1000 } = {}) {
  if (typeof value !== 'string') {
    throw validationError(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw validationError(`${name} must not be empty`);
  }
  if (trimmed.length > max) {
    throw validationError(`${name} exceeds maximum length of ${max}`);
  }
  return trimmed;
}

function assertEmail(value, name = 'email') {
  const str = assertString(value, name);
  if (!str.includes('@') || str.startsWith('@') || str.endsWith('@')) {
    throw validationError(`${name} must be a valid email address`);
  }
  return str.toLowerCase();
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

export const Boundary = {
  /**
   * Parse and validate POST /api/auth/signup payload.
   */
  parseSignUp(raw) {
    const body = assertObject(raw);
    const email = assertEmail(body.email);
    const password = assertString(body.password, 'password', { min: 1 });
    return { email, password };
  },

  /**
   * Parse and validate POST /api/auth/signin payload.
   */
  parseSignIn(raw) {
    const body = assertObject(raw);
    const email = assertString(body.email, 'email');
    const password = assertString(body.password, 'password');
    return { email, password };
  },

  /**
   * Parse and validate POST /api/auth/google payload.
   */
  parseGoogleAuth(raw) {
    const body = assertObject(raw);
    const idToken = assertString(body.idToken, 'idToken');
    return { idToken };
  },

  /**
   * Parse and validate POST /api/profiles payload.
   */
  parseCreateProfile(raw) {
    const body = assertObject(raw);
    const name = assertString(body.name, 'name', { min: 1, max: 50 });
    const maturity = body.maturity
      ? String(body.maturity).toLowerCase()
      : 'teen';
    if (!VALID_MATURITIES.has(maturity)) {
      throw validationError(`invalid maturity level: ${body.maturity}`);
    }
    return { name, maturity: /** @type {Maturity} */ (maturity) };
  },

  /**
   * Parse and validate GET /api/catalog/browse query params.
   */
  parseBrowseQuery(url) {
    const rawKind = url.searchParams.get('kind');
    const rawGenre = url.searchParams.get('genre');
    const kind = rawKind ? rawKind.toLowerCase().trim() : null;
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
    const body = assertObject(raw);
    if (!body.ref || typeof body.ref !== 'object') {
      throw validationError('unknown media kind');
    }
    const id = body.ref.id;
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw validationError('unknown media kind');
    }
    return {
      ref: {
        id: brandId(id.trim(), 'MediaId'),
        kind: body.ref.kind
          ? String(body.ref.kind).toLowerCase().trim()
          : undefined,
      },
    };
  },

  /**
   * Parse and validate POST /api/progress body.
   */
  parseProgressBody(raw) {
    const body = assertObject(raw);
    const itemId = assertString(body.itemId, 'itemId');
    const seconds = Math.max(0, Number(body.seconds) || 0);
    return { itemId: brandId(itemId, 'MediaId'), seconds };
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
