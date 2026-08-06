import { z } from 'zod'

// SQLite has no enum type, so these Zod enums are the single definition every
// status string is validated against. One place to change wording, and an
// invalid value is rejected at the boundary rather than discovered later.

export const MIGRATION_STAGES = [
  'not_started',
  'queued',
  'reading_source',
  'parsing_structure',
  'mapping_content',
  'generating_content',
  'copying_template',
  'writing_target',
  'validating',
  'awaiting_review',
  'approved',
  'exported',
  'failed',
] as const
export const MigrationStage = z.enum(MIGRATION_STAGES)
export type MigrationStage = z.infer<typeof MigrationStage>

/** Stages where the worker is actively doing something. */
export const PROCESSING_STAGES: readonly MigrationStage[] = [
  'reading_source',
  'parsing_structure',
  'mapping_content',
  'generating_content',
  'copying_template',
  'writing_target',
  'validating',
]

// Exactly the fourteen types the brief lists. Closed set — an unrecognised
// change type is a bug, not something to store and hope for.
export const CHANGE_TYPES = [
  'section_moved',
  'section_merged',
  'text_rewritten',
  'text_shortened',
  'procedure_converted_to_table',
  'responsibility_moved_to_praci',
  'monitoring_moved_to_cse',
  'reference_retained',
  'reference_missing',
  'duplicate_consolidated',
  'formatting_applied',
  'ambiguous_content',
  'content_unchanged',
  'content_unmapped',
] as const
export const ChangeType = z.enum(CHANGE_TYPES)
export type ChangeType = z.infer<typeof ChangeType>

export const ValidationResult = z.enum(['pass', 'warning', 'fail'])
export type ValidationResult = z.infer<typeof ValidationResult>

export const Severity = z.enum(['info', 'low', 'medium', 'high', 'critical'])
export type Severity = z.infer<typeof Severity>

export const ResolutionStatus = z.enum(['open', 'resolved', 'acknowledged', 'false_positive'])
export type ResolutionStatus = z.infer<typeof ResolutionStatus>

export const ReviewDecisionKind = z.enum(['approved', 'returned_for_correction'])
export type ReviewDecisionKind = z.infer<typeof ReviewDecisionKind>

export const ApprovalStatus = z.enum(['draft', 'pending', 'approved', 'rejected'])
export type ApprovalStatus = z.infer<typeof ApprovalStatus>

export const ResourceType = z.enum(['folder', 'document'])
export type ResourceType = z.infer<typeof ResourceType>

export const LinkValidationStatus = z.enum(['not_validated', 'valid', 'invalid'])
export type LinkValidationStatus = z.infer<typeof LinkValidationStatus>

export const BlockType = z.enum([
  'heading',
  'paragraph',
  'listItem',
  'table',
  'image',
  'pageBreak',
])
export type BlockType = z.infer<typeof BlockType>

export const MappingStatus = z.enum(['mapped', 'unmapped', 'ambiguous'])
export type MappingStatus = z.infer<typeof MappingStatus>

export const ExportFormat = z.enum(['csv', 'json', 'html'])
export type ExportFormat = z.infer<typeof ExportFormat>

/** The output version every migrated document carries. Fixed by the brief. */
export const OUTPUT_VERSION = '2.1'

/** Destination folder naming convention from the brief. */
export const DESTINATION_FOLDER_NAME = 'REVISED'
