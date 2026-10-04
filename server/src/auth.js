import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, newId, findAccountByEmail } from './store.js';
import { DomainError } from './errors.js';

function hashPassword(password, salt = randomBytes(8).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = scryptSync(password, salt, 32);
  return timingSafeEqual(attempt, Buffer.from(hash, 'hex'));
}

function issueSession(accountId) {
  const token = randomBytes(16).toString('hex');
  db.sessions.set(token, {
    accountId,
    expiresAt: Date.now() + 7 * 24 * 3600e3,
  });
  return { token, expiresAt: Date.now() + 7 * 24 * 3600e3 };
}

function emailFromGoogleIdToken(idToken) {
  if (!idToken || !idToken.startsWith('google:'))
    throw new DomainError('INVALID_GOOGLE_TOKEN', 'bad token');
  const email = idToken.slice('google:'.length).trim();
  if (!email)
    throw new DomainError('INVALID_GOOGLE_TOKEN', 'no email in token');
  return email;
}

function publicAccount(a) {
  return { id: a.id, email: a.email, provider: a.provider };
}

export const AuthService = {
  signUp({ email, password }) {
    if (findAccountByEmail(email))
      throw new DomainError('EMAIL_TAKEN', 'email already registered');
    const account = {
      id: newId('u'),
      email,
      provider: 'email',
      passwordHash: hashPassword(password),
    };
    db.accounts.set(account.id, account);
    return { user: publicAccount(account), session: issueSession(account.id) };
  },

  signIn({ email, password }) {
    const account = findAccountByEmail(email);
    if (
      !account ||
      !account.passwordHash ||
      !checkPassword(password, account.passwordHash)
    ) {
      throw new DomainError('INVALID_CREDENTIALS', 'bad email or password');
    }
    return { user: publicAccount(account), session: issueSession(account.id) };
  },

  signInWithGoogle({ idToken }) {
    const email = emailFromGoogleIdToken(idToken);
    let account = findAccountByEmail(email);
    if (!account) {
      account = {
        id: newId('u'),
        email,
        provider: 'google',
        passwordHash: null,
      };
      db.accounts.set(account.id, account);
    }
    return { user: publicAccount(account), session: issueSession(account.id) };
  },

  signOut(token) {
    if (token) db.sessions.delete(token);
  },

  accountForToken(token) {
    const s = db.sessions.get(token);
    if (!s || s.expiresAt < Date.now())
      throw new DomainError('SESSION_EXPIRED', 'expired');
    return db.accounts.get(s.accountId);
  },
};
