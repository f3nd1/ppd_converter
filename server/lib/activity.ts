import { prisma } from './db.ts'
import { log } from './logger.ts'

// The activity log is append-only at the database level (see the
// activity_log_append_only migration). There is deliberately no update or delete
// helper here — if one existed, the trigger would just turn a silent mistake
// into a runtime error somewhere less obvious.

export type ActivityInput = {
  action: string
  entityType?: string | null
  entityId?: string | null
  result?: 'success' | 'failure' | 'blocked'
  summary?: string | null
  errorRef?: string | null
  correlationId?: string | null
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        result: input.result ?? 'success',
        summary: input.summary ?? null,
        errorRef: input.errorRef ?? null,
        correlationId: input.correlationId ?? null,
      },
    })
  } catch (err) {
    // A failed audit write must never take down the operation being audited,
    // but it must not vanish either.
    log.error('failed to write activity log entry', {
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

const SG_FORMATTER = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  dateStyle: 'medium',
  timeStyle: 'medium',
})

/**
 * The brief requires both a UTC timestamp and an Asia/Singapore display
 * timestamp. Only UTC is stored; the local rendering is derived here so the two
 * can never drift apart in the database.
 */
export function toDisplayTimestamps(utc: Date) {
  return { utc: utc.toISOString(), singapore: SG_FORMATTER.format(utc) }
}
