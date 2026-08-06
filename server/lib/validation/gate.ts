// The approval gate. One pure function, called SERVER-SIDE on the approve route.
// The UI disabling a button is a convenience; this is the control.

export type GateItem = {
  result: 'pass' | 'warning' | 'fail'
  resolutionStatus: 'open' | 'resolved' | 'acknowledged' | 'false_positive'
}

export type GateVerdict = {
  canApprove: boolean
  /** Empty when canApprove is true. Shown to the reviewer verbatim. */
  blockers: string[]
  unresolvedFailures: number
  unacknowledgedWarnings: number
}

/**
 * A document cannot be approved while any fail-level item is unresolved.
 * Warnings do not block, but they must be explicitly acknowledged (or resolved,
 * or marked a false positive with justification) — silently ignoring one is the
 * exact failure mode this gate exists to prevent.
 */
export function evaluateApprovalGate(items: GateItem[]): GateVerdict {
  const isSettled = (i: GateItem) => i.resolutionStatus !== 'open'

  const unresolvedFailures = items.filter((i) => i.result === 'fail' && !isSettled(i)).length
  const unacknowledgedWarnings = items.filter((i) => i.result === 'warning' && !isSettled(i)).length

  const blockers: string[] = []
  if (unresolvedFailures > 0) {
    blockers.push(
      `${unresolvedFailures} validation failure${unresolvedFailures === 1 ? '' : 's'} must be resolved before approval.`,
    )
  }
  if (unacknowledgedWarnings > 0) {
    blockers.push(
      `${unacknowledgedWarnings} validation warning${unacknowledgedWarnings === 1 ? '' : 's'} must be acknowledged before approval.`,
    )
  }

  return {
    canApprove: blockers.length === 0,
    blockers,
    unresolvedFailures,
    unacknowledgedWarnings,
  }
}

export type MigrationReadiness = {
  hasApprovedActiveMapping: boolean
  hasActiveTemplate: boolean
  hasActiveAIInstruction: boolean
}

/**
 * Production migration is blocked until an approved active mapping version
 * exists. Enforced here and called from the queue route — the brief makes this
 * non-negotiable, so it is never inferred from UI state.
 */
export function canRunMigration(state: MigrationReadiness): {
  allowed: boolean
  blockers: string[]
} {
  const blockers: string[] = []
  if (!state.hasApprovedActiveMapping) {
    blockers.push('No approved active mapping version exists. Migration is blocked.')
  }
  if (!state.hasActiveTemplate) blockers.push('No active Google Docs template is configured.')
  if (!state.hasActiveAIInstruction) blockers.push('No active AI instruction version exists.')
  return { allowed: blockers.length === 0, blockers }
}
