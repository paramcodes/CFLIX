import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle ORM SQLite Schema for CFLIX.
 *
 * Defines the persistent tabular representation for user accounts,
 * authentication sessions, user profiles, and viewing progress.
 */

export const accountsTable = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  provider: text('provider').notNull(), // 'email' | 'google'
  passwordHash: text('password_hash'),
});

export const sessionsTable = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  accountId: text('account_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const profilesTable = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  maturity: text('maturity').notNull(), // 'child' | 'teen' | 'adult'
});

export const progressTable = sqliteTable('progress', {
  id: text('id').primaryKey(), // `${profileId}:${itemId}`
  profileId: text('profile_id').notNull(),
  itemId: text('item_id').notNull(),
  seconds: integer('seconds').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
