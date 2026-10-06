import { DomainError } from '../errors.js';

/**
 * Identity Provider Adapters for OAuth / OIDC Token Verification.
 */

export class GoogleIdentityProviderAdapter {
  /**
   * Verify an incoming Google ID Token.
   * @param {string} idToken
   * @returns {Promise<{ email: string; providerUserId?: string }>}
   */
  async verifyToken(idToken) {
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
