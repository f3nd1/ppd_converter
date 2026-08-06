import { type DocBlock, extractFactTokens, normaliseText } from '../doc/model.ts'

// Layer 1: pure code, no AI, read-only, pass/fail plus a reason. This layer is
// authoritative on anything countable — numbers, codes, clause numbers, dates,
// block coverage, hyperlinks. The AI layer never overrides it.
//
// Modelled on the invariant-checker approach in gd4_simulator's
// consistency-invariants document: state the rule, name the two things that must
// agree, and report honestly when they do not.

export type CheckResult = {
  category: string
  checkPerformed: string
  result: 'pass' | 'warning' | 'fail'
  details: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  sourceReference?: string | null
  targetReference?: string | null
  humanReviewRequired: boolean
}

export type DeterministicInput = {
  sourceBlocks: DocBlock[]
  /** blockId -> mapping status, one row per source block. */
  blockMappings: Map<string, 'mapped' | 'unmapped' | 'ambiguous'>
  targetSections: { name: string; content: string }[]
  requiredTargetSections: string[]
  sourceDocumentCode: string | null
  targetTitle: string
  expectedDestinationFolderId: string
  actualDestinationFolderId: string
  expectedTemplateId: string | null
  actualTemplateId: string | null
  sourceModifiedTimeAtScan: Date
  sourceModifiedTimeNow: Date
  duplicateTargetFound: boolean
  requiredMetadataPresent: boolean
}

const pass = (
  category: string,
  checkPerformed: string,
  details: string,
): CheckResult => ({
  category,
  checkPerformed,
  result: 'pass',
  details,
  severity: 'info',
  humanReviewRequired: false,
})

export function runDeterministicValidation(input: DeterministicInput): CheckResult[] {
  const results: CheckResult[] = []
  const targetText = input.targetSections.map((s) => s.content).join('\n')
  const normalisedTarget = normaliseText(targetText)

  // --- every source block is accounted for ---------------------------------
  const missing = input.sourceBlocks.filter((b) => !input.blockMappings.has(b.blockId))
  results.push(
    missing.length === 0
      ? pass(
          'completeness',
          'Every source content block has a mapping status',
          `All ${input.sourceBlocks.length} source blocks are accounted for.`,
        )
      : {
          category: 'completeness',
          checkPerformed: 'Every source content block has a mapping status',
          result: 'fail',
          details: `${missing.length} source block(s) have no mapping status: ${missing
            .slice(0, 5)
            .map((b) => b.blockId)
            .join(', ')}${missing.length > 5 ? ', …' : ''}`,
          severity: 'high',
          sourceReference: missing[0]?.blockId ?? null,
          humanReviewRequired: true,
        },
  )

  const unmapped = [...input.blockMappings.entries()].filter(([, s]) => s === 'unmapped')
  if (unmapped.length > 0) {
    results.push({
      category: 'completeness',
      checkPerformed: 'Source sections mapped to a target section',
      result: 'warning',
      details: `${unmapped.length} source block(s) were not mapped to any target section. A reviewer must confirm this is intended.`,
      severity: 'medium',
      sourceReference: unmapped[0]?.[0] ?? null,
      humanReviewRequired: true,
    })
  }

  const ambiguous = [...input.blockMappings.entries()].filter(([, s]) => s === 'ambiguous')
  if (ambiguous.length > 0) {
    results.push({
      category: 'completeness',
      checkPerformed: 'Ambiguous content flagged for review',
      result: 'warning',
      details: `${ambiguous.length} source block(s) were flagged as ambiguous.`,
      severity: 'medium',
      sourceReference: ambiguous[0]?.[0] ?? null,
      humanReviewRequired: true,
    })
  }

  // --- hyperlinks ----------------------------------------------------------
  const sourceLinks = input.sourceBlocks.flatMap((b) => b.links.map((l) => l.url))
  const uniqueSourceLinks = [...new Set(sourceLinks)]
  const missingLinks = uniqueSourceLinks.filter((url) => !targetText.includes(url))
  results.push(
    missingLinks.length === 0
      ? pass(
          'references',
          'Every source hyperlink is accounted for',
          uniqueSourceLinks.length === 0
            ? 'The source contains no hyperlinks.'
            : `All ${uniqueSourceLinks.length} source hyperlink(s) appear in the migrated document.`,
        )
      : {
          category: 'references',
          checkPerformed: 'Every source hyperlink is accounted for',
          result: 'warning',
          details: `${missingLinks.length} hyperlink(s) from the source are not present in the migrated document: ${missingLinks.slice(0, 3).join(', ')}`,
          severity: 'medium',
          sourceReference: missingLinks[0] ?? null,
          humanReviewRequired: true,
        },
  )

  // --- required target sections -------------------------------------------
  const presentSections = new Set(input.targetSections.map((s) => s.name))
  const missingSections = input.requiredTargetSections.filter((s) => !presentSections.has(s))
  results.push(
    missingSections.length === 0
      ? pass(
          'structure',
          'All required target sections exist',
          `All ${input.requiredTargetSections.length} required section(s) are present.`,
        )
      : {
          category: 'structure',
          checkPerformed: 'All required target sections exist',
          result: 'fail',
          details: `Missing required target section(s): ${missingSections.join(', ')}`,
          severity: 'high',
          targetReference: missingSections[0] ?? null,
          humanReviewRequired: true,
        },
  )

  // --- document code -------------------------------------------------------
  if (input.sourceDocumentCode) {
    const codeInTitle = input.targetTitle.includes(input.sourceDocumentCode)
    results.push(
      codeInTitle
        ? pass(
            'facts',
            'Document code is unchanged',
            `Document code "${input.sourceDocumentCode}" is preserved in the target title.`,
          )
        : {
            category: 'facts',
            checkPerformed: 'Document code is unchanged',
            result: 'fail',
            details: `Source document code "${input.sourceDocumentCode}" does not appear in the target title "${input.targetTitle}".`,
            severity: 'critical',
            sourceReference: input.sourceDocumentCode,
            targetReference: input.targetTitle,
            humanReviewRequired: true,
          },
    )
  }

  // --- clause numbers, dates and other factual tokens ----------------------
  const sourceTokens = new Set(
    input.sourceBlocks.flatMap((b) => extractFactTokens(b.text)),
  )
  const droppedTokens = [...sourceTokens].filter((t) => !normalisedTarget.includes(t))

  // Clause numbers are the strictest sub-case: losing one changes the structure
  // of a controlled document, so it fails rather than warns.
  const clauseRe = /^\d+(?:\.\d+)+$/
  const droppedClauses = droppedTokens.filter((t) => clauseRe.test(t))
  results.push(
    droppedClauses.length === 0
      ? pass(
          'facts',
          'Clause numbers are unchanged',
          'Every clause number in the source appears in the migrated document.',
        )
      : {
          category: 'facts',
          checkPerformed: 'Clause numbers are unchanged',
          result: 'fail',
          details: `${droppedClauses.length} clause number(s) present in the source are missing from the migrated document: ${droppedClauses.slice(0, 5).join(', ')}`,
          severity: 'critical',
          sourceReference: droppedClauses[0] ?? null,
          humanReviewRequired: true,
        },
  )

  const droppedOther = droppedTokens.filter((t) => !clauseRe.test(t))
  results.push(
    droppedOther.length === 0
      ? pass(
          'facts',
          'Dates and factual values are unchanged',
          'Every date, number and factual value in the source appears in the migrated document.',
        )
      : {
          category: 'facts',
          checkPerformed: 'Dates and factual values are unchanged',
          result: 'warning',
          details: `${droppedOther.length} factual value(s) from the source are not present in the migrated document: ${droppedOther.slice(0, 8).join(', ')}. Confirm each was intentionally removed.`,
          severity: 'high',
          sourceReference: droppedOther[0] ?? null,
          humanReviewRequired: true,
        },
  )

  // --- destination folder --------------------------------------------------
  results.push(
    input.expectedDestinationFolderId === input.actualDestinationFolderId
      ? pass('placement', 'Target folder is correct', 'The revised document is in the configured destination folder.')
      : {
          category: 'placement',
          checkPerformed: 'Target folder is correct',
          result: 'fail',
          details: `Expected destination folder ${input.expectedDestinationFolderId} but the document is in ${input.actualDestinationFolderId}.`,
          severity: 'high',
          humanReviewRequired: true,
        },
  )

  // --- template ------------------------------------------------------------
  results.push(
    input.expectedTemplateId && input.expectedTemplateId === input.actualTemplateId
      ? pass('template', 'Active template was used', `Created from template ${input.expectedTemplateId}.`)
      : {
          category: 'template',
          checkPerformed: 'Active template was used',
          result: 'fail',
          details: `Expected the active template ${input.expectedTemplateId ?? '(none)'} but the document records ${input.actualTemplateId ?? '(none)'}.`,
          severity: 'high',
          humanReviewRequired: true,
        },
  )

  // --- source unchanged ----------------------------------------------------
  const sourceUnchanged =
    input.sourceModifiedTimeAtScan.getTime() === input.sourceModifiedTimeNow.getTime()
  results.push(
    sourceUnchanged
      ? pass('source_integrity', 'Source document was not changed', 'The source modified time is unchanged since the scan.')
      : {
          category: 'source_integrity',
          checkPerformed: 'Source document was not changed',
          result: 'fail',
          details: `The source document was modified after the scan (scan: ${input.sourceModifiedTimeAtScan.toISOString()}, now: ${input.sourceModifiedTimeNow.toISOString()}). The migration may not reflect the current source.`,
          severity: 'high',
          humanReviewRequired: true,
        },
  )

  // --- duplicate target ----------------------------------------------------
  results.push(
    !input.duplicateTargetFound
      ? pass('placement', 'No unintended duplicate target exists', 'No other document with this title exists in the destination folder.')
      : {
          category: 'placement',
          checkPerformed: 'No unintended duplicate target exists',
          result: 'fail',
          details: `Another document titled "${input.targetTitle}" already exists in the destination folder.`,
          severity: 'high',
          humanReviewRequired: true,
        },
  )

  // --- metadata ------------------------------------------------------------
  results.push(
    input.requiredMetadataPresent
      ? pass('metadata', 'Required metadata is stored', 'Template, AI instruction and mapping versions are all recorded.')
      : {
          category: 'metadata',
          checkPerformed: 'Required metadata is stored',
          result: 'fail',
          details: 'One or more of the template, AI instruction or mapping version references is missing from the migration record.',
          severity: 'high',
          humanReviewRequired: true,
        },
  )

  return results
}
