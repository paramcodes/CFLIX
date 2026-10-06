import { eq, and } from 'drizzle-orm';
import {
  accountsTable,
  sessionsTable,
  profilesTable,
  progressTable,
} from './schema.js';
import { orm as defaultOrm } from './index.js';

/**
 * Drizzle ORM implementation of AccountRepositoryPort.
 */
export class DrizzleAccountRepository {
  /** @param {any} [db] */
  constructor(db = defaultOrm) {
    this.db = db;
  }

  findByEmail(email) {
    const row = this.db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.email, email.toLowerCase().trim()))
      .get();
    return row
      ? {
          id: row.id,
          email: row.email,
          provider: row.provider,
          passwordHash: row.passwordHash,
        }
      : null;
  }

  findById(id) {
    const row = this.db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, id))
      .get();
    return row
      ? {
          id: row.id,
          email: row.email,
          provider: row.provider,
          passwordHash: row.passwordHash,
        }
      : null;
  }

  save(account) {
    this.db
      .insert(accountsTable)
      .values({
        id: account.id,
        email: account.email.toLowerCase().trim(),
        provider: account.provider,
        passwordHash: account.passwordHash ?? null,
      })
      .onConflictDoUpdate({
        target: accountsTable.id,
        set: {
          email: account.email.toLowerCase().trim(),
          provider: account.provider,
          passwordHash: account.passwordHash ?? null,
        },
      })
      .run();
  }

  listAll() {
    return this.db.select().from(accountsTable).all();
  }
}

/**
 * Drizzle ORM implementation of SessionRepositoryPort.
 */
export class DrizzleSessionRepository {
  /** @param {any} [db] */
  constructor(db = defaultOrm) {
    this.db = db;
  }

  findByToken(token) {
    const row = this.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.token, token))
      .get();
    return row
      ? {
          token: row.token,
          accountId: row.accountId,
          expiresAt: row.expiresAt,
        }
      : null;
  }

  save(session) {
    this.db
      .insert(sessionsTable)
      .values({
        token: session.token,
        accountId: session.accountId,
        expiresAt: session.expiresAt,
      })
      .onConflictDoUpdate({
        target: sessionsTable.token,
        set: {
          accountId: session.accountId,
          expiresAt: session.expiresAt,
        },
      })
      .run();
  }

  delete(token) {
    this.db.delete(sessionsTable).where(eq(sessionsTable.token, token)).run();
  }
}

/**
 * Drizzle ORM implementation of ProfileRepositoryPort.
 */
export class DrizzleProfileRepository {
  /** @param {any} [db] */
  constructor(db = defaultOrm) {
    this.db = db;
  }

  listByAccountId(accountId) {
    const rows = this.db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.accountId, accountId))
      .all();
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      name: r.name,
      maturity: r.maturity,
    }));
  }

  findById(id) {
    const row = this.db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, id))
      .get();
    return row
      ? {
          id: row.id,
          accountId: row.accountId,
          name: row.name,
          maturity: row.maturity,
        }
      : null;
  }

  save(profile) {
    this.db
      .insert(profilesTable)
      .values({
        id: profile.id,
        accountId: profile.accountId,
        name: profile.name,
        maturity: profile.maturity,
      })
      .onConflictDoUpdate({
        target: profilesTable.id,
        set: {
          name: profile.name,
          maturity: profile.maturity,
        },
      })
      .run();
  }

  delete(id) {
    this.db.delete(profilesTable).where(eq(profilesTable.id, id)).run();
  }

  listAll() {
    return this.db.select().from(profilesTable).all();
  }
}

/**
 * Drizzle ORM implementation of ProgressRepositoryPort.
 */
export class DrizzleProgressRepository {
  /** @param {any} [db] */
  constructor(db = defaultOrm) {
    this.db = db;
  }

  listByProfileId(profileId) {
    const rows = this.db
      .select()
      .from(progressTable)
      .where(eq(progressTable.profileId, profileId))
      .all();
    return rows.map((r) => ({
      id: r.id,
      profileId: r.profileId,
      itemId: r.itemId,
      seconds: r.seconds,
      updatedAt: r.updatedAt,
    }));
  }

  findByItem(profileId, itemId) {
    const row = this.db
      .select()
      .from(progressTable)
      .where(
        and(
          eq(progressTable.profileId, profileId),
          eq(progressTable.itemId, String(itemId)),
        ),
      )
      .get();
    return row
      ? {
          id: row.id,
          profileId: row.profileId,
          itemId: row.itemId,
          seconds: row.seconds,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  save(entry) {
    const id = entry.id || `${entry.profileId}:${entry.itemId}`;
    this.db
      .insert(progressTable)
      .values({
        id,
        profileId: entry.profileId,
        itemId: String(entry.itemId),
        seconds: entry.seconds,
        updatedAt: entry.updatedAt,
      })
      .onConflictDoUpdate({
        target: progressTable.id,
        set: {
          seconds: entry.seconds,
          updatedAt: entry.updatedAt,
        },
      })
      .run();
  }

  listAll() {
    return this.db.select().from(progressTable).all();
  }
}
