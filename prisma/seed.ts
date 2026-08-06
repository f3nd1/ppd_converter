import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../server/generated/prisma/client.ts'
import { DEFAULT_AI_INSTRUCTIONS } from '../server/lib/ai/prompts.ts'

// Seeds ONLY what the brief mandates and what invents nothing:
//
//  - Criteria 1 to 7, labelled by number. The brief requires seven expandable
//    sections; a number is not an invented name.
//  - The default AI instruction set, quoted verbatim from the brief.
//
// It deliberately does NOT seed sub-criteria. Whether the official 29 are
// imported from gd4_simulator or typed in by hand is still an open decision
// (plan §21 O-3), and picking one here would be deciding it by default.
//
// No mapping version is seeded either — production migration must stay blocked
// until a human creates and approves one.

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? 'file:./data/ppd.db',
})
const prisma = new PrismaClient({ adapter })

async function main() {
  for (let n = 1; n <= 7; n += 1) {
    await prisma.criterion.upsert({
      where: { number: n },
      update: {},
      create: { number: n, title: `Criterion ${n}`, order: n },
    })
  }

  const existingInstruction = await prisma.aIInstructionVersion.findFirst()
  if (!existingInstruction) {
    await prisma.aIInstructionVersion.create({
      data: {
        versionLabel: 'v1 (default)',
        body: DEFAULT_AI_INSTRUCTIONS,
        isActive: true,
        activatedAt: new Date(),
      },
    })
  }

  await prisma.activityLog.create({
    data: {
      action: 'configuration_change',
      entityType: 'System',
      summary: 'Database seeded: 7 criteria and the default AI instruction version.',
    },
  })

  const criteria = await prisma.criterion.count()
  const subCriteria = await prisma.subCriterion.count()
  console.log(`Seeded. Criteria: ${criteria}. Sub-criteria: ${subCriteria} (none seeded by design).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
