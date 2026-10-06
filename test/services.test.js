import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createAuthService } from '../server/src/auth.js';
import { createProfileService } from '../server/src/profiles.js';
import { createDatabaseConnection } from '../server/src/db/index.js';
import {
  DrizzleAccountRepository,
  DrizzleSessionRepository,
  DrizzleProfileRepository,
} from '../server/src/db/repositories.js';
import { MockIdentityProviderAdapter } from '../server/src/auth/identity-provider.js';

describe('Application Services & Dependency Inversion', () => {
  const { orm } = createDatabaseConnection(':memory:');
  const accountRepo = new DrizzleAccountRepository(orm);
  const sessionRepo = new DrizzleSessionRepository(orm);
  const profileRepo = new DrizzleProfileRepository(orm);

  const authService = createAuthService({
    accountRepo,
    sessionRepo,
    identityProvider: new MockIdentityProviderAdapter({
      email: 'mock_google@test.dev',
    }),
  });

  const profileService = createProfileService({
    profileRepo,
  });

  it('AuthService signs up and signs in with injected repositories', () => {
    const signup = authService.signUp({
      email: 'bob@test.dev',
      password: 'password123',
    });
    assert.equal(signup.user.email, 'bob@test.dev');
    assert.ok(signup.session.token);

    const signin = authService.signIn({
      email: 'bob@test.dev',
      password: 'password123',
    });
    assert.equal(signin.user.email, 'bob@test.dev');
  });

  it('AuthService verifies Google token via injected IdentityProviderPort', async () => {
    const googleLogin = await authService.signInWithGoogle({
      idToken: 'any-valid-token-handled-by-mock',
    });
    assert.equal(googleLogin.user.email, 'mock_google@test.dev');
    assert.equal(googleLogin.user.provider, 'google');
  });

  it('ProfileService creates and lists profiles with injected ProfileRepository', () => {
    const profile = profileService.create('u_bob', {
      name: 'Bob Profile',
      maturity: 'teen',
    });
    assert.equal(profile.name, 'Bob Profile');
    assert.equal(profile.maturity, 'teen');

    const list = profileService.list('u_bob');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, profile.id);
  });
});
