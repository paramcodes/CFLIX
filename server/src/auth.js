import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  newId,
  accountRepo as defaultAccountRepo,
  sessionRepo as defaultSessionRepo,
} from './store.js';
import { GoogleIdentityProviderAdapter } from './auth/identity-provider.js';
import { DomainError } from './errors.js';

function hashPassword(password, salt = randomBytes(8).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = scryptSync(password, salt, 32);
  return timingSafeEqual(attempt, Buffer.from(hash, 'hex'));
}

function publicAccount(a) {
  return { id: a.id, email: a.email, provider: a.provider };
}

/**
 * Factory for creating an AuthService instance with injected ports (Dependency Inversion).
 *
 * @param {Object} [deps]
 * @param {import('./domain/ports.js').AccountRepositoryPort} [deps.accountRepo]
 * @param {import('./domain/ports.js').SessionRepositoryPort} [deps.sessionRepo]
 * @param {import('./domain/ports.js').IdentityProviderPort} [deps.identityProvider]
 */
export function createAuthService({
  accountRepo = defaultAccountRepo,
  sessionRepo = defaultSessionRepo,
  identityProvider = new GoogleIdentityProviderAdapter(),
} = {}) {
  function issueSession(accountId) {
    const token = randomBytes(16).toString('hex');
    const session = {
      token,
      accountId,
      expiresAt: Date.now() + 7 * 24 * 3600e3,
    };
    sessionRepo.save(session);
    return { token, expiresAt: session.expiresAt };
  }

  return {
    signUp({ email, password }) {
      if (accountRepo.findByEmail(email)) {
        throw new DomainError('EMAIL_TAKEN', 'email already registered');
      }
      const account = {
        id: newId('u'),
        email,
        provider: /** @type {const} */ ('email'),
        passwordHash: hashPassword(password),
      };
      accountRepo.save(account);
      return {
        user: publicAccount(account),
        session: issueSession(account.id),
      };
    },

    signIn({ email, password }) {
      const account = accountRepo.findByEmail(email);
      if (
        !account ||
        !account.passwordHash ||
        !checkPassword(password, account.passwordHash)
      ) {
        throw new DomainError('INVALID_CREDENTIALS', 'bad email or password');
      }
      return {
        user: publicAccount(account),
        session: issueSession(account.id),
      };
    },

    async signInWithGoogle({ idToken }) {
      const { email } = await identityProvider.verifyToken(idToken);
      let account = accountRepo.findByEmail(email);
      if (!account) {
        account = {
          id: newId('u'),
          email,
          provider: /** @type {const} */ ('google'),
          passwordHash: null,
        };
        accountRepo.save(account);
      }
      return {
        user: publicAccount(account),
        session: issueSession(account.id),
      };
    },

    signOut(token) {
      if (token) sessionRepo.delete(token);
    },

    accountForToken(token) {
      const s = sessionRepo.findByToken(token);
      if (!s || s.expiresAt < Date.now()) {
        throw new DomainError('SESSION_EXPIRED', 'expired');
      }
      const acc = accountRepo.findById(s.accountId);
      if (!acc) throw new DomainError('NOT_FOUND', 'no such account');
      return acc;
    },
  };
}

export const AuthService = createAuthService();
