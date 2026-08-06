import { describe, expect, it } from 'vitest'
import { AIValidationOutput, ProposedChange, RewriteOutput, toJsonSchema } from '../schemas.ts'
import { CHANGE_TYPES } from '../../enums.ts'

// Structured AI output is validated on receipt and REJECTED, never repaired.
// These tests are the guard against a malformed or hallucinated shape being
// accepted as if it were sound.

describe('RewriteOutput validation', () => {
  it('accepts a well-formed response', () => {
    const result = RewriteOutput.safeParse({
      overallReasoning: 'Mapped everything.',
      sections: [
        {
          reasoning: 'Belongs in Procedure.',
          targetSection: 'Procedure',
          sourceBlockIds: ['b1'],
          format: 'paragraphs',
          paragraphs: ['Text.'],
          table: null,
        },
      ],
      changes: [
        {
          reason: 'Rewritten.',
          changeType: 'text_rewritten',
          sourceSection: null,
          targetSection: 'Procedure',
          sourceBlockId: 'b1',
          confidence: 0.8,
        },
      ],
      unmappedBlockIds: [],
      ambiguities: [],
    })
    expect(result.success).toBe(true)
  })

  it('REJECTS an invented change type', () => {
    const result = ProposedChange.safeParse({
      reason: 'x',
      changeType: 'completely_made_up_type',
      confidence: 0.5,
    })
    expect(result.success).toBe(false)
  })

  it('accepts every change type the brief lists, and only those', () => {
    expect(CHANGE_TYPES).toHaveLength(14)
    for (const changeType of CHANGE_TYPES) {
      expect(ProposedChange.safeParse({ reason: 'r', changeType, confidence: 0.5 }).success).toBe(true)
    }
  })

  it('REJECTS a confidence outside 0..1', () => {
    expect(
      ProposedChange.safeParse({ reason: 'r', changeType: 'text_rewritten', confidence: 1.5 }).success,
    ).toBe(false)
  })

  it('REJECTS a missing required field rather than defaulting it', () => {
    expect(RewriteOutput.safeParse({ sections: [], changes: [] }).success).toBe(false)
  })

  it('REJECTS free-form text where structure is required', () => {
    expect(RewriteOutput.safeParse('the migration went fine').success).toBe(false)
  })
})

describe('AIValidationOutput validation', () => {
  it('accepts a well-formed validation response', () => {
    expect(
      AIValidationOutput.safeParse({
        overallReasoning: 'Compared both.',
        summary: 'One omission found.',
        items: [
          {
            details: 'The retention period was dropped.',
            category: 'material_omission',
            result: 'fail',
            severity: 'high',
            sourceReference: 'b2',
            targetReference: null,
            humanReviewRequired: true,
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('REJECTS an invented category', () => {
    expect(
      AIValidationOutput.safeParse({
        overallReasoning: 'x',
        summary: 'y',
        items: [
          {
            details: 'd',
            category: 'vibes_were_off',
            result: 'fail',
            severity: 'high',
            humanReviewRequired: true,
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('REJECTS a result outside pass/warning/fail', () => {
    expect(
      AIValidationOutput.safeParse({
        overallReasoning: 'x',
        summary: 'y',
        items: [
          {
            details: 'd',
            category: 'factual_change',
            result: 'probably_fine',
            severity: 'high',
            humanReviewRequired: true,
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('schema field order', () => {
  // Constrained decoding emits fields in schema order, so reasoning must come
  // before the verdict it justifies.
  it('puts reasoning before the verdict in the change schema', () => {
    const schema = toJsonSchema(ProposedChange) as { properties: Record<string, unknown> }
    const keys = Object.keys(schema.properties)
    expect(keys.indexOf('reason')).toBeLessThan(keys.indexOf('changeType'))
  })

  it('puts details before result in the validation item schema', () => {
    const schema = toJsonSchema(AIValidationOutput) as {
      properties: { items: { items: { properties: Record<string, unknown> } } }
    }
    const keys = Object.keys(schema.properties.items.items.properties)
    expect(keys.indexOf('details')).toBeLessThan(keys.indexOf('result'))
  })

  it('produces a JSON schema OpenAI can consume', () => {
    const schema = toJsonSchema(RewriteOutput) as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
  })
})
