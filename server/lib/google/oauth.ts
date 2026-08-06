import { createHash, randomBytes } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { env } from '../env.ts'

// OAuth 2.0 Authorization Code flow with PKCE, server-side. google-auth-library
// handles the token exchange, refresh and — critically — ID token signature
// verification. That last one is a security boundary and is not hand-rolled:
// trusting an unverified JWT payload would let anyone claim to be the
// authorised account.

/**
 * The minimum scopes needed to read selected source folders and documents, copy
 * the approved template, and write the revised document.
 *
 * ⚠️ Open question O-1 in the plan: `drive.file` grants access only to files the
 * app created or the user explicitly opened, so copying the template INTO a
 * user-created REVISED folder may require the broader
 * `https://www.googleapis.com/auth/drive`. That is settled by a spike against a
 * throwaway folder once credentials exist — deliberately not guessed. It is one
 * constant, so resolving it changes this list and nothing else.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
] as const

export function makeOAuthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  })
}

export type PkcePair = { verifier: string; challenge: string }

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createState(): string {
  return randomBytes(24).toString('base64url')
}

export function buildAuthUrl(args: { state: string; codeChallenge: string }): string {
  const client = makeOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [...GOOGLE_SCOPES],
    state: args.state,
    code_challenge_method: 'S256' as never,
    code_challenge: args.codeChallenge,
    // Forced consent because Google only reliably re-issues a refresh token when
    // the user is prompted — gd4_simulator hit exactly this and documented it.
    prompt: 'consent',
    include_granted_scopes: true,
  })
}

export type ExchangeResult = {
  email: string
  emailVerified: boolean
  refreshToken: string | null
  accessToken: string | null
  expiryDate: number | null
  scopes: string
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<ExchangeResult> {
  const client = makeOAuthClient()
  const { tokens } = await client.getToken({ code, codeVerifier })

  if (!tokens.id_token) throw new Error('Google did not return an ID token.')

  // Signature + audience verified by the library. Never decode and trust.
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  if (!payload?.email) throw new Error('Google ID token contained no email address.')

  return {
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token ?? null,
    expiryDate: tokens.expiry_date ?? null,
    scopes: tokens.scope ?? [...GOOGLE_SCOPES].join(' '),
  }
}

/** Exchanges a stored refresh token for a fresh access token. Never persisted. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  expiryDate: number | null
}> {
  const client = makeOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await client.refreshAccessToken()
  if (!credentials.access_token) throw new Error('Google did not return an access token.')
  return { accessToken: credentials.access_token, expiryDate: credentials.expiry_date ?? null }
}

/**
 * Server-side account restriction. Case-insensitive, exact match only — no
 * domain wildcard, because the brief restricts access to one named account and
 * a domain rule would silently widen it.
 */
export function isAuthorisedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email.trim().toLowerCase() === env.ALLOWED_GOOGLE_EMAIL.trim().toLowerCase()
}
