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

describe('Google sign-in against an existing account', () => {
  const MERGE_EMAIL = 'merge_by_email@test.dev';

  function authServiceForVerifiedIdentity(email) {
    const { orm } = createDatabaseConnection(':memory:');
    const accountRepo = new DrizzleAccountRepository(orm);
    return {
      accountRepo,
      // MockIdentityProviderAdapter stands in for an identity verified upstream.
      authService: createAuthService({
        accountRepo,
        sessionRepo: new DrizzleSessionRepository(orm),
        identityProvider: new MockIdentityProviderAdapter({ email }),
      }),
    };
  }

  it('resolves two verified sign-ins with the same email to one account', async () => {
    const { authService, accountRepo } =
      authServiceForVerifiedIdentity(MERGE_EMAIL);
    const owner = authService.signUp({
      email: MERGE_EMAIL,
      password: 'password123',
    });

    const first = await authService.signInWithGoogle({
      idToken: 'verified-token-1',
    });
    const second = await authService.signInWithGoogle({
      idToken: 'verified-token-2',
    });

    assert.equal(first.user.id, owner.user.id);
    assert.equal(second.user.id, owner.user.id);

    const rows = accountRepo.listAll().filter((a) => a.email === MERGE_EMAIL);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'email');
    assert.equal(
      authService.signIn({ email: MERGE_EMAIL, password: 'password123' }).user
        .id,
      owner.user.id,
    );
  });
});
