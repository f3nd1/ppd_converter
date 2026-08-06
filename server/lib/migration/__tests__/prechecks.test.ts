import { describe, expect, it } from 'vitest'
import { runPrechecks, type PrecheckInput } from '../prechecks.ts'

const scanTime = new Date('2026-08-01T10:00:00Z')

const ok = (): PrecheckInput => ({
  sourceAccessible: true,
  destinationFolderAccessible: true,
  activeTemplateValid: true,
  activeAIInstructionExists: true,
  approvedActiveMappingExists: true,
  requiredMetadataPresent: true,
  targetAlreadyExists: false,
  sourceModifiedTimeNow: new Date(scanTime),
  sourceModifiedTimeAtScan: scanTime,
})

describe('runPrechecks', () => {
  it('passes when everything is in order', () => {
    expect(runPrechecks(ok()).passed).toBe(true)
  })

  it('fails without an approved active mapping', () => {
    const result = runPrechecks({ ...ok(), approvedActiveMappingExists: false })
    expect(result.passed).toBe(false)
    expect(result.failures.join(' ')).toContain('Migration is blocked')
  })

  it('fails when the source changed after the scan', () => {
    const result = runPrechecks({
      ...ok(),
      sourceModifiedTimeNow: new Date('2026-08-02T10:00:00Z'),
    })
    expect(result.passed).toBe(false)
    expect(result.failures.join(' ')).toContain('changed since it was scanned')
  })

  it('treats an unreadable modified time as changed, not as fine', () => {
    const result = runPrechecks({ ...ok(), sourceModifiedTimeNow: null })
    expect(result.passed).toBe(false)
    expect(result.failures.join(' ')).toContain('could not be read')
  })

  it('refuses to silently overwrite an existing revised document', () => {
    const result = runPrechecks({ ...ok(), targetAlreadyExists: true })
    expect(result.passed).toBe(false)
    expect(result.failures.join(' ')).toContain('already exists')
  })

  it('fails when the source is unreachable', () => {
    expect(runPrechecks({ ...ok(), sourceAccessible: false }).passed).toBe(false)
  })

  it('fails without a valid template', () => {
    expect(runPrechecks({ ...ok(), activeTemplateValid: false }).passed).toBe(false)
  })

  it('fails without an active AI instruction', () => {
    expect(runPrechecks({ ...ok(), activeAIInstructionExists: false }).passed).toBe(false)
  })

  it('reports every failure rather than stopping at the first', () => {
    const result = runPrechecks({
      ...ok(),
      sourceAccessible: false,
      activeTemplateValid: false,
      approvedActiveMappingExists: false,
    })
    expect(result.failures.length).toBeGreaterThanOrEqual(3)
  })
})
