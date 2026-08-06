// Phase 1 measurement checkpoint (plan §18).
//
// The box runs four other apps in 1.9 GiB, so "how much memory does this app
// actually cost" needed a real number rather than an estimate. Run with:
//
//   node scripts/measure.mjs
//
// It loads each runtime dependency in turn and reports the RSS it added, so an
// expensive one is visible individually rather than buried in a total. Re-run it
// on the server to confirm the numbers there.

const mb = (bytes) => +(bytes / 1024 / 1024).toFixed(1)

// Settle allocations from Node's own startup before taking the baseline.
await new Promise((r) => setTimeout(r, 100))
const baseline = process.memoryUsage().rss

// Ordered roughly cheapest-first so the expensive ones stand out.
const DEPS = [
  ['zod', () => import('zod')],
  ['iron-session', () => import('iron-session')],
  ['helmet', () => import('helmet')],
  ['express', () => import('express')],
  ['better-sqlite3', () => import('better-sqlite3')],
  ['openai', () => import('openai')],
  ['google-auth-library', () => import('google-auth-library')],
  // Prisma last and measured separately: it is by far the largest single cost,
  // and a connected client costs more than the bare import.
  ['@prisma/client (import)', () => import('../server/generated/prisma/client.ts')],
]

const rows = []
let previous = baseline

for (const [name, load] of DEPS) {
  try {
    await load()
  } catch (err) {
    rows.push({ dependency: name, addedMb: 'FAILED', totalMb: '-', note: err.message.slice(0, 60) })
    continue
  }
  const now = process.memoryUsage().rss
  rows.push({ dependency: name, addedMb: mb(now - previous), totalMb: mb(now - baseline) })
  previous = now
}

const loaded = process.memoryUsage().rss

console.log(`\nnode ${process.version} · ${process.platform}/${process.arch}`)
console.log(`baseline RSS (bare Node)      ${mb(baseline)} MB`)
console.table(rows)
console.log(`RSS with all deps loaded      ${mb(loaded)} MB`)
console.log(`added by dependencies         ${mb(loaded - baseline)} MB`)
console.log(
  `\nThis is import cost only. Real serving RSS is higher — measure the running` +
    `\nserver with:  curl -s http://127.0.0.1:4020/ppd_converter/api/health\n`,
)

// A connected Prisma client, which is what actually runs in production.
const beforeConnect = process.memoryUsage().rss
try {
  const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
  const { PrismaClient } = await import('../server/generated/prisma/client.ts')
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./data/ppd.db' }),
  })
  await client.$queryRawUnsafe('SELECT 1')
  const after = process.memoryUsage().rss
  console.log(`Prisma client connected + 1 query   +${mb(after - beforeConnect)} MB  (total ${mb(after)} MB)`)
  await client.$disconnect()
} catch (err) {
  console.log(`Prisma connect measurement skipped: ${err.message.slice(0, 80)}`)
}
