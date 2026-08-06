import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { log, newCorrelationId } from './logger.ts'

// Shared HTTP concerns: correlation ids, CSRF, rate limiting, validation and a
// consistent error shape. Every user-facing error carries a correlation id so a
// report of "it broke" can be traced to a log line.

export function correlation(req: Request, res: Response, next: NextFunction) {
  req.correlationId = newCorrelationId()
  res.setHeader('X-Correlation-Id', req.correlationId)
  next()
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF: SameSite=Lax already blocks cross-site POSTs from a form, and this adds
 * an explicit Origin/Referer check so a browser that mishandles SameSite does
 * not become the single point of failure.
 */
export function csrfGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING.has(req.method)) return next()

    const origin = req.get('origin') ?? undefined
    const referer = req.get('referer') ?? undefined
    const candidate = origin ?? referer

    if (!candidate) {
      res.status(403).json({ error: 'Missing Origin header.', correlationId: req.correlationId })
      return
    }
    let host: string
    try {
      host = new URL(candidate).origin
    } catch {
      res.status(403).json({ error: 'Malformed Origin header.', correlationId: req.correlationId })
      return
    }
    if (!allowedOrigins.includes(host)) {
      res.status(403).json({ error: 'Cross-origin request refused.', correlationId: req.correlationId })
      return
    }
    next()
  }
}

type Bucket = { tokens: number; lastRefill: number }
const buckets = new Map<string, Bucket>()

/**
 * In-process token bucket. Adequate precisely because this app is single-user
 * and single-process — a shared store would be infrastructure for a problem
 * that does not exist here.
 */
export function rateLimit(name: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip ?? 'unknown'}`
    const now = Date.now()
    const bucket = buckets.get(key) ?? { tokens: limit, lastRefill: now }

    const refill = Math.floor(((now - bucket.lastRefill) / windowMs) * limit)
    if (refill > 0) {
      bucket.tokens = Math.min(limit, bucket.tokens + refill)
      bucket.lastRefill = now
    }

    if (bucket.tokens <= 0) {
      buckets.set(key, bucket)
      res.status(429).json({
        error: 'Too many requests. Wait a moment and try again.',
        correlationId: req.correlationId,
      })
      return
    }

    bucket.tokens -= 1
    buckets.set(key, bucket)
    next()
  }
}

/** Test seam — the bucket map is module state and would leak between tests. */
export function resetRateLimits(): void {
  buckets.clear()
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ')
    throw new HttpError(400, detail)
  }
  return result.data
}

/** Wraps an async handler so a rejected promise becomes a proper 500, not a hang. */
export function handler(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next)
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err instanceof HttpError ? err.status : 500
  const message = err instanceof Error ? err.message : 'Unexpected error'

  // Logged with the correlation id; the client gets the id but never a stack.
  log.error('request failed', {
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    status,
    message,
  })

  if (res.headersSent) return
  res.status(status).json({
    error: status === 500 ? 'Something went wrong.' : message,
    correlationId: req.correlationId,
  })
}

/**
 * Express 5 types route params as `string | string[]` because a repeated param
 * can legitimately be an array. Every param in this app is single-valued, so
 * narrowing once here beats casting at forty call sites.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `Missing "${name}" in the request path.`)
  }
  return value
}
