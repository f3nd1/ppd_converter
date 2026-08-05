import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Plan §1b: PPD Converter must share nothing with gd4_simulator or any other app
// on this server, at build time or runtime. Patterns were copied from
// gd4_simulator by hand; no line of its code is imported.
//
// This test makes that rule checkable rather than merely promised — it fails the
// build on the day someone adds `../../gd4_simulator/...` rather than at 3am
// after a sibling app's refactor breaks this one.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SCAN_DIRS = ['server', 'src', 'scripts']
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.jsx'])

// Every other application known to live on this server. A relative import that
// escapes the project root is caught generically below; naming these as well
// catches an absolute path or a symlink, which escaping alone would not.
const FOREIGN_APPS = [
  'gd4_simulator',
  'admission-screening',
  'ai_impact_builder',
  'social_media_os',
  'ucc_qa_hub',
]

const IMPORT_RE = /(?:^|\s)(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    return [] // directory not created yet in an early phase
  }
  return entries.flatMap((entry) => {
    const full = path.join(abs, entry)
    if (statSync(full).isDirectory()) return sourceFiles(path.join(dir, entry))
    return SOURCE_EXT.has(path.extname(entry)) ? [path.join(dir, entry)] : []
  })
}

function importSpecifiers(contents: string): string[] {
  const found: string[] = []
  for (const match of contents.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3]
    if (spec) found.push(spec)
  }
  return found
}

describe('project isolation', () => {
  const files = SCAN_DIRS.flatMap(sourceFiles)

  it('finds source files to check', () => {
    // Guards against the scan silently passing because it looked in the wrong place.
    expect(files.length).toBeGreaterThan(0)
  })

  it('has no relative import that escapes the project root', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const spec of importSpecifiers(readFileSync(path.join(ROOT, file), 'utf8'))) {
        if (!spec.startsWith('.')) continue
        const resolved = path.resolve(path.dirname(path.join(ROOT, file)), spec)
        if (!resolved.startsWith(ROOT + path.sep)) offenders.push(`${file} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no import naming another application on this server', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const spec of importSpecifiers(readFileSync(path.join(ROOT, file), 'utf8'))) {
        const segments = spec.split('/')
        if (FOREIGN_APPS.some((app) => segments.includes(app))) offenders.push(`${file} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('detects a violation when one is present', () => {
    // The checks above pass trivially on a clean tree, which would hide a broken
    // matcher. This proves the matcher actually fires.
    const bad = `import { thing } from '../../gd4_simulator/src/lib/scoring.ts'`
    const [spec] = importSpecifiers(bad)
    expect(spec).toBe('../../gd4_simulator/src/lib/scoring.ts')
    expect(spec!.split('/').some((s) => FOREIGN_APPS.includes(s))).toBe(true)
  })
})
