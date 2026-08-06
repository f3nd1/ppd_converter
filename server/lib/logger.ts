import { randomUUID } from 'node:crypto'

// Two hard rules from the brief drive this module:
//   - no secret ever reaches a log
//   - no source-document content ever reaches an ordinary log
// So logging goes through here rather than raw console.log, and everything is
// redacted on the way out.

const SECRET_KEY_RE =
  /(access_?token|refresh_?token|client_?secret|api_?key|authorization|encryption_?key|session_?secret|password|cookie|bearer)/i

// Recognisable secret shapes, in case one arrives inside a free-text string
// rather than under an obvious key.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI keys
  /\bGOCSPX-[A-Za-z0-9_-]{10,}\b/g, // Google client secrets
  /\bya29\.[A-Za-z0-9._-]{10,}\b/g, // Google access tokens
  /\b1\/\/[A-Za-z0-9._-]{20,}\b/g, // Google refresh tokens
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi,
]

export const REDACTED = '[redacted]'

export function redactString(input: string): string {
  return SECRET_VALUE_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), input)
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[too deep]'
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redact(val, depth + 1)
  }
  return out
}

export function newCorrelationId(): string {
  return randomUUID()
}

type Level = 'info' | 'warn' | 'error'

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  const line = {
    at: new Date().toISOString(),
    level,
    message: redactString(message),
    ...(context ? { context: redact(context) } : {}),
  }
  const text = JSON.stringify(line)
  if (level === 'error') console.error(text)
  else if (level === 'warn') console.warn(text)
  else console.log(text)
}

export const log = {
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
}
