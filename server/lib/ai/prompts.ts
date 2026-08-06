import type { DocBlock } from '../doc/model.ts'

// Two prompts, deliberately kept apart. The rewrite engine and the validator
// never share a prompt or a response — the brief requires the validation pass to
// be an independent check, and a validator that saw the rewriter's reasoning
// would just agree with it.

/** The default AI instruction set, seeded on first run and versioned thereafter. */
export const DEFAULT_AI_INSTRUCTIONS = `Use UK English.

Preserve all original meaning, terminology, numbering and control intent.

Do not invent facts, roles, approvals, systems, evidence, records, frequencies, thresholds, dates, document names, document codes, clause numbers or regulatory requirements.

Do not change factual content.

Map source content only according to the active approved mapping rules.

Convert suitable long procedural passages into structured tables.

Preserve references and hyperlinks where technically possible.

Flag ambiguous, conflicting, incomplete or unmapped content.

Produce a detailed change record for every migrated document.`

export function rewriteSystemPrompt(instructions: string, targetSections: string[]): string {
  return `You are migrating a Policy & Procedure Document (PPD) for United Ceres College into a new template structure.

${instructions}

The only permitted target sections are:
${targetSections.map((s) => `- ${s}`).join('\n')}

Rules that override anything else:
- Every paragraph you emit must be traceable to one or more source block IDs you were given. Never write content that is not derived from the source.
- Never alter a number, date, clause number, document code, percentage, monetary value, role name or approval authority. Copy them exactly as they appear.
- If content does not fit any mapping rule, list its block ID in unmappedBlockIds. Do not force it into a section.
- If content is ambiguous or contradictory, describe it in ambiguities. Do not resolve it by guessing.
- Record one change entry for every transformation you make, including content you left unchanged.`
}

export function rewriteUserPrompt(args: {
  documentTitle: string
  documentCode: string | null
  blocks: DocBlock[]
  mappingRules: { oldSectionName: string; newTargetSection: string; transformationRule: string }[]
}): string {
  const blockLines = args.blocks.map(
    (b) => `[${b.blockId}] (${b.type}${b.level ? ` h${b.level}` : ''}) ${b.text}`,
  )
  const ruleLines = args.mappingRules.map(
    (r) => `- "${r.oldSectionName}" -> "${r.newTargetSection}": ${r.transformationRule}`,
  )

  return `Document title: ${args.documentTitle}
Document code: ${args.documentCode ?? '(none — do not invent one)'}

APPROVED MAPPING RULES (the only mapping you may apply):
${ruleLines.join('\n')}

SOURCE CONTENT BLOCKS:
${blockLines.join('\n')}`
}

export const VALIDATION_SYSTEM_PROMPT = `You are an independent reviewer checking whether a migrated Policy & Procedure Document faithfully preserves its source. You did not perform the migration and must not assume it was done correctly.

Compare the source content against the migrated content and report every discrepancy you can substantiate, in these categories:
meaning preservation, material omission, unsupported additions, contradictions, ambiguous interpretation, over-aggressive shortening, role changes, approval changes, frequency changes, evidence changes, record changes, numbering changes, factual changes, control-intent changes.

Rules:
- Quote or reference the specific source and target content for every item you raise. Do not raise an item you cannot point at.
- Use "fail" only for a discrepancy that changes meaning, facts, numbering or control intent. Use "warning" where something needs a human to look at it. Use "pass" for a check you performed that found nothing.
- Do not invent problems to appear thorough, and do not withhold one to appear agreeable.
- You are advisory. A human makes the final decision, so state uncertainty plainly rather than resolving it.`

export function validationUserPrompt(args: {
  sourceBlocks: DocBlock[]
  targetSections: { name: string; content: string }[]
}): string {
  return `SOURCE CONTENT:
${args.sourceBlocks.map((b) => `[${b.blockId}] ${b.text}`).join('\n')}

MIGRATED CONTENT:
${args.targetSections.map((s) => `## ${s.name}\n${s.content}`).join('\n\n')}`
}
