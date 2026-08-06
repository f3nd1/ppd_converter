import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client.ts'
import { env } from './env.ts'

// One client for the process. PM2 runs a single fork instance precisely so there
// is exactly one writer against this file — cluster mode would break that.
const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL })

export const prisma = new PrismaClient({ adapter })

/**
 * WAL lets a reader run while the migration worker writes, and NORMAL sync is
 * the usual durability trade for WAL — a crash can lose the last commits but
 * cannot corrupt the file. Both are cheap and matter on a box this small.
 */
export function applyPragmas(): void {
  prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL').catch(() => {})
  prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL').catch(() => {})
  prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON').catch(() => {})
}
