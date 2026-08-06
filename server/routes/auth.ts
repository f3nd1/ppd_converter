import { Router } from 'express'
import { z } from 'zod'
import { recordActivity } from '../lib/activity.ts'
import { seal } from '../lib/crypto.ts'
import { prisma } from '../lib/db.ts'
import { capabilities, env } from '../lib/env.ts'
import {
  buildAuthUrl,
  createPkcePair,
  createState,
  exchangeCode,
  GOOGLE_SCOPES,
  isAuthorisedEmail,
} from '../lib/google/oauth.ts'
import { handler, rateLimit } from '../lib/http.ts'
import { log } from '../lib/logger.ts'
import { BASE_PATH, clearSession, issueSession } from '../lib/session.ts'

export const authRouter = Router()

// The PKCE verifier and state are held server-side for the seconds between
// redirect and callback. A single-user app does not need a store for this, and a
// cookie would put the verifier in the browser where it is least useful.
const pending = new Map<string, { verifier: string; createdAt: number }>()
const STATE_TTL_MS = 10 * 60 * 1000

function prunePending() {
  const cutoff = Date.now() - STATE_TTL_MS
  for (const [state, entry] of pending) if (entry.createdAt < cutoff) pending.delete(state)
}

authRouter.get(
  '/google/start',
  rateLimit('auth_start', 10, 60_000),
  handler(async (_req, res) => {
    if (!capabilities().google) {
      res.status(503).json({
        error:
          'Google sign-in is not configured yet. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ENCRYPTION_KEY must be set in .env.',
      })
      return
    }
    prunePending()
    const { verifier, challenge } = createPkcePair()
    const state = createState()
    pending.set(state, { verifier, createdAt: Date.now() })
    res.redirect(buildAuthUrl({ state, codeChallenge: challenge }))
  }),
)

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
})

authRouter.get(
  '/google/callback',
  rateLimit('auth_callback', 20, 60_000),
  handler(async (req, res) => {
    const query = callbackQuery.safeParse(req.query)
    if (!query.success || query.data.error || !query.data.code || !query.data.state) {
      res.status(400).send(renderAuthPage('Sign-in was cancelled or failed.', false))
      return
    }

    prunePending()
    const entry = pending.get(query.data.state)
    // Single-use: a replayed state must not work.
    pending.delete(query.data.state)
    if (!entry) {
      res.status(400).send(renderAuthPage('This sign-in link has expired. Try again.', false))
      return
    }

    let result
    try {
      result = await exchangeCode(query.data.code, entry.verifier)
    } catch (err) {
      log.error('OAuth exchange failed', {
        correlationId: req.correlationId,
        message: err instanceof Error ? err.message : String(err),
      })
      await recordActivity({
        action: 'google_authentication',
        result: 'failure',
        summary: 'Token exchange failed.',
        correlationId: req.correlationId,
      })
      res.status(400).send(renderAuthPage('Google sign-in failed.', false))
      return
    }

    // The account restriction. Verified email only — an unverified claim is not
    // an identity. No session, no token stored, for anyone else.
    if (!result.emailVerified || !isAuthorisedEmail(result.email)) {
      await recordActivity({
        action: 'google_authentication',
        result: 'blocked',
        summary: `Refused sign-in for an account that is not ${env.ALLOWED_GOOGLE_EMAIL}.`,
        correlationId: req.correlationId,
      })
      res
        .status(403)
        .send(
          renderAuthPage(
            `Only ${env.ALLOWED_GOOGLE_EMAIL} may use this application. You were signed out.`,
            false,
          ),
        )
      return
    }

    const user = await prisma.appUser.upsert({
      where: { email: result.email },
      update: { isAuthorised: true, lastLoginAt: new Date() },
      create: { email: result.email, isAuthorised: true, lastLoginAt: new Date() },
    })

    // Google only returns a refresh token on a consent-granting exchange. When
    // it does not, the previously stored one stays valid and is left alone.
    if (result.refreshToken) {
      const sealed = seal(result.refreshToken)
      await prisma.oAuthCredential.deleteMany({ where: { appUserId: user.id } })
      await prisma.oAuthCredential.create({
        data: {
          appUserId: user.id,
          refreshTokenEnc: sealed.ciphertext,
          iv: sealed.iv,
          authTag: sealed.authTag,
          scopes: result.scopes || [...GOOGLE_SCOPES].join(' '),
          expiresAt: result.expiryDate ? new Date(result.expiryDate) : null,
        },
      })
    }

    await issueSession(res, result.email)
    await recordActivity({
      action: 'google_authentication',
      entityType: 'AppUser',
      entityId: user.id,
      summary: `Signed in as ${result.email}`,
      correlationId: req.correlationId,
    })
    res.redirect(`${BASE_PATH}/`)
  }),
)

authRouter.post(
  '/signout',
  handler(async (req, res) => {
    clearSession(res)
    await recordActivity({
      action: 'google_authentication',
      summary: 'Signed out.',
      correlationId: req.correlationId,
    })
    res.json({ ok: true })
  }),
)

authRouter.get(
  '/me',
  handler(async (req, res) => {
    res.json({
      email: req.session?.email ?? null,
      authorised: isAuthorisedEmail(req.session?.email),
      capabilities: capabilities(),
      allowedAccount: env.ALLOWED_GOOGLE_EMAIL,
    })
  }),
)

function renderAuthPage(message: string, ok: boolean): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>PPD Converter</title>
<style>body{font-family:system-ui,sans-serif;margin:3rem;color:#16191d}
.box{max-width:34rem;border:1px solid #d8dde3;border-radius:6px;padding:1.25rem}
a{color:#1a4b8c}</style></head><body><div class="box">
<h1>PPD Converter</h1><p>${ok ? '' : '<strong>Sign-in refused.</strong> '}${message}</p>
<p><a href="${BASE_PATH}/">Return to the application</a></p></div></body></html>`
}
