import { DomainError } from '../errors.js';

/**
 * Identity Provider Adapters for OAuth / OIDC Token Verification.
 */

/**
 * Values of CFLIX_GOOGLE_TOKEN_TRUSTED that opt into the unverified prefix check. Anything
 * else, including a typo, leaves Google sign-in refused.
 */
const TRUSTED_TOKEN_VALUES = ['true', '1', 'yes', 'on'];

function googleTokensTrusted() {
  const chosen = process.env.CFLIX_GOOGLE_TOKEN_TRUSTED;
  return TRUSTED_TOKEN_VALUES.includes((chosen || '').trim().toLowerCase());
}

export class GoogleIdentityProviderAdapter {
  /**
   * Verify an incoming Google ID Token.
   *
   * Refuses by default: nothing here validates a signature, so `google:<email>` is an
   * attacker-chosen email and accepting it hands over any account that owns it.
   *
   * @param {string} idToken
   * @returns {Promise<{ email: string; providerUserId?: string }>}
   */
  async verifyToken(idToken) {
    if (!googleTokensTrusted()) {
      throw new DomainError(
        'INVALID_GOOGLE_TOKEN',
        'google sign-in is not configured on this server',
      );
    }
    if (!idToken || !idToken.startsWith('google:')) {
      throw new DomainError('INVALID_GOOGLE_TOKEN', 'bad token');
    }
    const email = idToken.slice('google:'.length).trim();
    if (!email) {
      throw new DomainError('INVALID_GOOGLE_TOKEN', 'no email in token');
    }
    return { email };
  }
}

export class MockIdentityProviderAdapter {
  constructor(mockUser = { email: 'mock_user@test.dev' }) {
    this.mockUser = mockUser;
  }

  async verifyToken(_idToken) {
    return this.mockUser;
  }
}
