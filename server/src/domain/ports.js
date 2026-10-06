/**
 * Domain Repository Ports for CFLIX.
 *
 * In Hexagonal Architecture (Ports and Adapters), the core domain defines
 * abstract ports (interfaces) describing the data access operations it needs.
 *
 * Domain services (AuthService, ProfileService, CatalogService) interact only with
 * these ports, never directly with SQLite, Postgres, or Drizzle drivers.
 */

/**
 * @typedef {import('../boundary.js').AccountId} AccountId
 * @typedef {import('../boundary.js').ProfileId} ProfileId
 * @typedef {import('../boundary.js').MediaId} MediaId
 * @typedef {import('../boundary.js').Maturity} Maturity
 *
 * @typedef {Object} AccountEntity
 * @property {string} id
 * @property {string} email
 * @property {'email' | 'google'} provider
 * @property {string|null} passwordHash
 *
 * @typedef {Object} SessionEntity
 * @property {string} token
 * @property {string} accountId
 * @property {number} expiresAt
 *
 * @typedef {Object} ProfileEntity
 * @property {string} id
 * @property {string} accountId
 * @property {string} name
 * @property {Maturity} maturity
 *
 * @typedef {Object} ProgressEntity
 * @property {string} id
 * @property {string} profileId
 * @property {string} itemId
 * @property {number} seconds
 * @property {string} updatedAt
 */

/**
 * Account Repository Port interface.
 * @typedef {Object} AccountRepositoryPort
 * @property {(email: string) => AccountEntity | null} findByEmail
 * @property {(id: string) => AccountEntity | null} findById
 * @property {(account: AccountEntity) => void} save
 * @property {() => AccountEntity[]} listAll
 */

/**
 * Session Repository Port interface.
 * @typedef {Object} SessionRepositoryPort
 * @property {(token: string) => SessionEntity | null} findByToken
 * @property {(session: SessionEntity) => void} save
 * @property {(token: string) => void} delete
 */

/**
 * Profile Repository Port interface.
 * @typedef {Object} ProfileRepositoryPort
 * @property {(accountId: string) => ProfileEntity[]} listByAccountId
 * @property {(id: string) => ProfileEntity | null} findById
 * @property {(profile: ProfileEntity) => void} save
 * @property {(id: string) => void} delete
 * @property {() => ProfileEntity[]} listAll
 */

/**
 * Progress Repository Port interface.
 * @typedef {Object} ProgressRepositoryPort
 * @property {(profileId: string) => ProgressEntity[]} listByProfileId
 * @property {(profileId: string, itemId: string) => ProgressEntity | null} findByItem
 * @property {(progress: ProgressEntity) => void} save
 * @property {() => ProgressEntity[]} listAll
 */
