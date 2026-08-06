import { sealData, unsealData } from 'iron-session'
import type { NextFunction, Request, Response } from 'express'
import { env } from './env.ts'
import { isAuthorisedEmail } from './google/oauth.ts'

// iron-session used framework-agnostically (sealData/unsealData) rather than as
// middleware, so there is no session table and no store to keep. The cookie is
// encrypted, not merely signed.

export const SESSION_COOKIE = 'ppd_session'
export const BASE_PATH = '/ppd_converter'
const TTL_SECONDS = 60 * 60 * 12

export type SessionData = { email: string; issuedAt: number }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionData
      correlationId: string
    }
  }
}

function password(): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters.')
  }
  return env.SESSION_SECRET
}

export async function issueSession(res: Response, email: string): Promise<void> {
  const sealed = await sealData({ email, issuedAt: Date.now() } satisfies SessionData, {
    password: password(),
    ttl: TTL_SECONDS,
  })
  res.cookie(SESSION_COOKIE, sealed, {
    httpOnly: true,
    // Lax rather than Strict: the OAuth callback is a top-level cross-site
    // navigation back from Google, and Strict would drop the cookie on it.
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: BASE_PATH,
    maxAge: TTL_SECONDS * 1000,
  })
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: BASE_PATH })
}

export async function readSession(req: Request): Promise<SessionData | null> {
  const raw = req.cookies?.[SESSION_COOKIE]
  if (!raw) return null
  try {
    const data = await unsealData<SessionData>(raw, { password: password(), ttl: TTL_SECONDS })
    return data?.email ? data : null
  } catch {
    // Tampered, expired or encrypted under an old secret — all mean "no session".
    return null
  }
}

/**
 * Populates req.session. Does NOT reject — routes decide. Kept separate so the
 * authorisation decision is always an explicit call, never an accident of
 * middleware ordering.
 */
export async function attachSession(req: Request, _res: Response, next: NextFunction) {
  req.session = (await readSession(req)) ?? undefined
  next()
}

/**
 * The account restriction, re-checked on every request rather than trusted from
 * login time — defence in depth, per the brief. A session naming an account that
 * is no longer the authorised one is rejected even though its cookie is valid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.email) {
    res.status(401).json({ error: 'Not signed in.', correlationId: req.correlationId })
    return
  }
  if (!isAuthorisedEmail(req.session.email)) {
    res.status(403).json({ error: 'This account is not authorised.', correlationId: req.correlationId })
    return
  }
  next()
}
