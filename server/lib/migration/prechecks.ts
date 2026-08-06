// Pre-migration checks. All must pass — there is no override, because every one
// of them protects something the brief says must never happen (a modified
// source, a duplicated target, a migration run without an approved mapping).

export type PrecheckInput = {
  sourceAccessible: boolean
  destinationFolderAccessible: boolean
  activeTemplateValid: boolean
  activeAIInstructionExists: boolean
  approvedActiveMappingExists: boolean
  requiredMetadataPresent: boolean
  targetAlreadyExists: boolean
  /** null when the source could not be read — treated as changed, not as fine. */
  sourceModifiedTimeNow: Date | null
  sourceModifiedTimeAtScan: Date
}

export type PrecheckResult = { passed: boolean; failures: string[] }

export function runPrechecks(input: PrecheckInput): PrecheckResult {
  const failures: string[] = []

  if (!input.sourceAccessible) failures.push('The source document is not accessible.')
  if (!input.destinationFolderAccessible) {
    failures.push('The destination folder is not accessible.')
  }
  if (!input.activeTemplateValid) {
    failures.push('There is no valid active Google Docs template.')
  }
  if (!input.activeAIInstructionExists) {
    failures.push('There is no active AI instruction version.')
  }
  if (!input.approvedActiveMappingExists) {
    failures.push('No approved active mapping version exists. Migration is blocked.')
  }
  if (!input.requiredMetadataPresent) {
    failures.push('Required document metadata is missing.')
  }
  if (input.targetAlreadyExists) {
    failures.push(
      'A revised document with this title already exists in the destination folder. ' +
        'Confirm explicitly before overwriting it.',
    )
  }

  // An unreadable source is treated as changed. Assuming "probably fine" here
  // would migrate content nobody has verified.
  if (!input.sourceModifiedTimeNow) {
    failures.push('The source document modified time could not be read.')
  } else if (
    input.sourceModifiedTimeNow.getTime() !== input.sourceModifiedTimeAtScan.getTime()
  ) {
    failures.push(
      'The source document has changed since it was scanned. Re-scan it before migrating.',
    )
  }

  return { passed: failures.length === 0, failures }
}
