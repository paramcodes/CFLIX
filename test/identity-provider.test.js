import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  GoogleIdentityProviderAdapter,
  MockIdentityProviderAdapter,
} from '../server/src/auth/identity-provider.js';

const TRUST_FLAG = 'CFLIX_GOOGLE_TOKEN_TRUSTED';
const adapter = new GoogleIdentityProviderAdapter();

function reset() {
  delete process.env[TRUST_FLAG];
}

async function codeOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err.code;
  }
  return null;
}

describe('GoogleIdentityProviderAdapter', () => {
  beforeEach(reset);
  afterEach(reset);

  it('refuses the unverified google:<email> form when the flag is unset', async () => {
    assert.equal(
      await codeOf(adapter.verifyToken('google:victim@example.com')),
      'INVALID_GOOGLE_TOKEN',
    );
  });

  it('refuses every input when the flag is unset, trusted or not', async () => {
    const inputs = [
      undefined,
      '',
      'not-a-token',
      'google:',
      'google:   ',
      'google:victim@example.com',
      'GOOGLE:victim@example.com',
      ' google:victim@example.com',
    ];
    for (const input of inputs) {
      assert.equal(
        await codeOf(adapter.verifyToken(input)),
        'INVALID_GOOGLE_TOKEN',
        `expected ${JSON.stringify(input)} to be refused`,
      );
    }
  });

  it('refuses when the flag holds a typo rather than an allowlisted value', async () => {
    process.env[TRUST_FLAG] = 'flase';
    assert.equal(
      await codeOf(adapter.verifyToken('google:victim@example.com')),
      'INVALID_GOOGLE_TOKEN',
    );
  });

  it('restores the prefix check when the flag is set, for local development', async () => {
    process.env[TRUST_FLAG] = 'true';
    assert.deepEqual(await adapter.verifyToken('google:dev@x.dev'), {
      email: 'dev@x.dev',
    });
  });

  it('still rejects a malformed token while the flag is set', async () => {
    process.env[TRUST_FLAG] = 'true';
    assert.equal(
      await codeOf(adapter.verifyToken('nope')),
      'INVALID_GOOGLE_TOKEN',
    );
    assert.equal(
      await codeOf(adapter.verifyToken('google:')),
      'INVALID_GOOGLE_TOKEN',
    );
  });
});

describe('MockIdentityProviderAdapter', () => {
  it('returns its injected user regardless of any token', async () => {
    reset();
    const mock = new MockIdentityProviderAdapter({
      email: 'mock_google@test.dev',
    });
    assert.deepEqual(await mock.verifyToken('anything at all'), {
      email: 'mock_google@test.dev',
    });
  });
});
