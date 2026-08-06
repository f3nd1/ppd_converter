import { z } from 'zod'
import { CHANGE_TYPES } from '../enums.ts'

// A convention carried over from gd4_simulator (as a pattern, not code): KEY
// ORDER MATTERS. Constrained decoding emits fields in schema order, so every
// reasoning/rationale field is declared BEFORE the verdict it justifies —
// reversing it measurably degrades judgement quality.

// --- Rewrite engine -------------------------------------------------------

export const RewrittenSection = z.object({
  reasoning: z.string().describe('Why this content belongs in this target section.'),
  targetSection: z.string(),
  sourceBlockIds: z.array(z.string()),
  // A table is emitted when the mapping rule calls for one; otherwise paragraphs.
  format: z.enum(['paragraphs', 'table']),
  paragraphs: z.array(z.string()).default([]),
  table: z
    .object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) })
    .nullable()
    .default(null),
})

export const ProposedChange = z.object({
  reason: z.string(),
  changeType: z.enum(CHANGE_TYPES),
  sourceSection: z.string().nullable().default(null),
  targetSection: z.string().nullable().default(null),
  sourceBlockId: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
})

export const RewriteOutput = z.object({
  overallReasoning: z.string(),
  sections: z.array(RewrittenSection),
  changes: z.array(ProposedChange),
  // Anything the model could not place under the approved mapping. Surfaced to
  // the reviewer rather than guessed at.
  unmappedBlockIds: z.array(z.string()).default([]),
  ambiguities: z.array(z.string()).default([]),
})
export type RewriteOutput = z.infer<typeof RewriteOutput>

// --- Validation engine (a separate call with a separate prompt) -----------

export const AI_VALIDATION_CATEGORIES = [
  'meaning_preservation',
  'material_omission',
  'unsupported_addition',
  'contradiction',
  'ambiguous_interpretation',
  'over_aggressive_shortening',
  'role_change',
  'approval_change',
  'frequency_change',
  'evidence_change',
  'record_change',
  'numbering_change',
  'factual_change',
  'control_intent_change',
] as const

export const AIValidationItem = z.object({
  details: z.string(),
  category: z.enum(AI_VALIDATION_CATEGORIES),
  result: z.enum(['pass', 'warning', 'fail']),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  sourceReference: z.string().nullable().default(null),
  targetReference: z.string().nullable().default(null),
  humanReviewRequired: z.boolean(),
})

export const AIValidationOutput = z.object({
  overallReasoning: z.string(),
  summary: z.string(),
  items: z.array(AIValidationItem),
})
export type AIValidationOutput = z.infer<typeof AIValidationOutput>

/**
 * Zod → JSON Schema for OpenAI structured outputs. Only the subset this app
 * uses is handled; anything else throws loudly rather than emitting a schema
 * that silently does not constrain the model.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>
}
