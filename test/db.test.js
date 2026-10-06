import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createDatabaseConnection } from '../server/src/db/index.js';
import {
  DrizzleAccountRepository,
  DrizzleSessionRepository,
  DrizzleProfileRepository,
  DrizzleProgressRepository,
} from '../server/src/db/repositories.js';

describe('Database & Drizzle Repository Ports (In-Memory SQLite)', () => {
  const { orm } = createDatabaseConnection(':memory:');
  const accountRepo = new DrizzleAccountRepository(orm);
  const sessionRepo = new DrizzleSessionRepository(orm);
  const profileRepo = new DrizzleProfileRepository(orm);
  const progressRepo = new DrizzleProgressRepository(orm);

  it('Account Repository operations', () => {
    assert.equal(accountRepo.findByEmail('alice@test.dev'), null);

    const account = {
      id: 'u_1',
      email: 'alice@test.dev',
      provider: /** @type {const} */ ('email'),
      passwordHash: 'hash123',
    };
    accountRepo.save(account);

    const found = accountRepo.findByEmail('alice@test.dev');
    assert.deepEqual(found, account);

    const foundById = accountRepo.findById('u_1');
    assert.deepEqual(foundById, account);

    // Update account
    accountRepo.save({ ...account, passwordHash: 'hash456' });
    const updated = accountRepo.findById('u_1');
    assert.equal(updated?.passwordHash, 'hash456');
  });

  it('Session Repository operations', () => {
    assert.equal(sessionRepo.findByToken('token_1'), null);

    const session = {
      token: 'token_1',
      accountId: 'u_1',
      expiresAt: Date.now() + 10000,
    };
    sessionRepo.save(session);
    assert.deepEqual(sessionRepo.findByToken('token_1'), session);

    sessionRepo.delete('token_1');
    assert.equal(sessionRepo.findByToken('token_1'), null);
  });

  it('Profile Repository operations', () => {
    assert.deepEqual(profileRepo.listByAccountId('u_1'), []);

    const profile1 = {
      id: 'p_1',
      accountId: 'u_1',
      name: 'Kid Profile',
      maturity: /** @type {const} */ ('child'),
    };
    const profile2 = {
      id: 'p_2',
      accountId: 'u_1',
      name: 'Adult Profile',
      maturity: /** @type {const} */ ('adult'),
    };

    profileRepo.save(profile1);
    profileRepo.save(profile2);

    const list = profileRepo.listByAccountId('u_1');
    assert.equal(list.length, 2);
    assert.deepEqual(profileRepo.findById('p_1'), profile1);

    profileRepo.delete('p_1');
    assert.equal(profileRepo.findById('p_1'), null);
    assert.equal(profileRepo.listByAccountId('u_1').length, 1);
  });

  it('Progress Repository operations', () => {
    assert.deepEqual(progressRepo.listByProfileId('p_2'), []);

    const entry = {
      id: 'p_2:seed:m1',
      profileId: 'p_2',
      itemId: 'seed:m1',
      seconds: 240,
      updatedAt: new Date().toISOString(),
    };
    progressRepo.save(entry);

    const found = progressRepo.findByItem('p_2', 'seed:m1');
    assert.equal(found?.seconds, 240);

    const list = progressRepo.listByProfileId('p_2');
    assert.equal(list.length, 1);
  });
});
