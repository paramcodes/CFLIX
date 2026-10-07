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

// Every value the operator might plausibly set, with the outcome written out literally. A row
// that derived its expectation from the adapter would pass for any parse at all, which is the
// regression this table exists to catch: a truthy parse that accepts `flase` hands back a live
// session for whoever's email was typed.
const REFUSED = [
  ['false', 'false'],
  ['0', '0'],
  ['no', 'no'],
  ['off', 'off'],
  ['FALSE', 'uppercase FALSE'],
  ['Off', 'mixed-case Off'],
  ['fALSE', 'mixed-case fALSE'],
  ['flase', 'typo of false'],
  ['typo', 'the literal word typo'],
  ['', 'empty string'],
  ['banana', 'unrelated word'],
  ['t', 'first letter of true only'],
  ['tru', 'true minus its last letter'],
  ['enabled', 'a plausible synonym that is not on the allowlist'],
];

const ACCEPTED = [
  ['true', 'lowercase true'],
  ['TRUE', 'uppercase TRUE'],
  ['On', 'mixed-case On'],
  ['tRUE', 'mixed-case tRUE'],
  ['1', 'numeric 1'],
  ['yes', 'lowercase yes'],
  ['on', 'lowercase on'],
  [' true', 'padded true, leading space'],
  ['yes ', 'padded yes, trailing space'],
  [' true ', 'padded true, both sides'],
];

describe('GoogleIdentityProviderAdapter refusal by default', () => {
  beforeEach(reset);
  afterEach(reset);

  it('refuses the unverified google:<email> form when the flag is unset', async () => {
    assert.equal(
      await codeOf(adapter.verifyToken('google:victim@example.com')),
      'INVALID_GOOGLE_TOKEN',
    );
  });

  it('refuses every input when the flag is unset', async () => {
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
});

describe('CFLIX_GOOGLE_TOKEN_TRUSTED truthy parse', () => {
  afterEach(reset);

  for (const [value, why] of REFUSED) {
    it(`refuses ${JSON.stringify(value)} (${why})`, async () => {
      process.env[TRUST_FLAG] = value;
      assert.equal(
        await codeOf(adapter.verifyToken('google:victim@example.com')),
        'INVALID_GOOGLE_TOKEN',
        `${JSON.stringify(value)} must not enable trust`,
      );
    });
  }

  for (const [value, why] of ACCEPTED) {
    it(`accepts ${JSON.stringify(value)} (${why})`, async () => {
      process.env[TRUST_FLAG] = value;
      assert.deepEqual(await adapter.verifyToken('google:dev@x.dev'), {
        email: 'dev@x.dev',
      });
    });
  }
});

describe('GoogleIdentityProviderAdapter with trust enabled', () => {
  afterEach(reset);

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
