import { describe, expect, it } from 'vitest'
import { canRunMigration, evaluateApprovalGate, type GateItem } from '../gate.ts'

const item = (
  result: GateItem['result'],
  resolutionStatus: GateItem['resolutionStatus'] = 'open',
): GateItem => ({ result, resolutionStatus })

describe('evaluateApprovalGate', () => {
  it('allows approval when everything passed', () => {
    expect(evaluateApprovalGate([item('pass'), item('pass')]).canApprove).toBe(true)
  })

  it('BLOCKS approval while any failure is unresolved', () => {
    const verdict = evaluateApprovalGate([item('pass'), item('fail')])
    expect(verdict.canApprove).toBe(false)
    expect(verdict.unresolvedFailures).toBe(1)
    expect(verdict.blockers[0]).toContain('must be resolved')
  })

  it('still blocks when several failures are unresolved', () => {
    expect(evaluateApprovalGate([item('fail'), item('fail')]).unresolvedFailures).toBe(2)
  })

  it('allows approval once a failure is resolved', () => {
    expect(evaluateApprovalGate([item('fail', 'resolved')]).canApprove).toBe(true)
  })

  it('accepts a failure marked as a false positive', () => {
    expect(evaluateApprovalGate([item('fail', 'false_positive')]).canApprove).toBe(true)
  })

  it('requires warnings to be acknowledged', () => {
    const verdict = evaluateApprovalGate([item('warning')])
    expect(verdict.canApprove).toBe(false)
    expect(verdict.unacknowledgedWarnings).toBe(1)
    expect(verdict.blockers[0]).toContain('acknowledged')
  })

  it('allows approval once warnings are acknowledged', () => {
    expect(evaluateApprovalGate([item('warning', 'acknowledged')]).canApprove).toBe(true)
  })

  it('reports both blockers when failures and warnings are outstanding', () => {
    expect(evaluateApprovalGate([item('fail'), item('warning')]).blockers).toHaveLength(2)
  })

  it('treats an empty result set as approvable', () => {
    expect(evaluateApprovalGate([]).canApprove).toBe(true)
  })
})

describe('canRunMigration', () => {
  const ready = {
    hasApprovedActiveMapping: true,
    hasActiveTemplate: true,
    hasActiveAIInstruction: true,
  }

  it('allows migration when everything is configured', () => {
    expect(canRunMigration(ready).allowed).toBe(true)
  })

  it('BLOCKS migration with no approved active mapping', () => {
    const verdict = canRunMigration({ ...ready, hasApprovedActiveMapping: false })
    expect(verdict.allowed).toBe(false)
    expect(verdict.blockers.join(' ')).toContain('No approved active mapping')
  })

  it('blocks with no active template', () => {
    expect(canRunMigration({ ...ready, hasActiveTemplate: false }).allowed).toBe(false)
  })

  it('blocks with no active AI instruction', () => {
    expect(canRunMigration({ ...ready, hasActiveAIInstruction: false }).allowed).toBe(false)
  })

  it('lists every blocker at once rather than only the first', () => {
    expect(
      canRunMigration({
        hasApprovedActiveMapping: false,
        hasActiveTemplate: false,
        hasActiveAIInstruction: false,
      }).blockers,
    ).toHaveLength(3)
  })
})
