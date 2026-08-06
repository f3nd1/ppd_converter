import { unseal } from '../crypto.ts'
import { prisma } from '../db.ts'
import { makeDocsClient } from './docs.ts'
import { makeDriveClient } from './drive.ts'
import { refreshAccessToken } from './oauth.ts'

// Builds Drive/Docs clients from the stored refresh token.
//
// The access token is held in memory for the life of the request only — never
// written to the database, never logged. Only the refresh token is persisted,
// and only encrypted.

export class NotConnectedError extends Error {
  constructor() {
    super('Google is not connected. Sign in with the authorised account first.')
    this.name = 'NotConnectedError'
  }
}

let cached: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  // 60s of slack so a token cannot expire between this check and the API call.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const credential = await prisma.oAuthCredential.findFirst({
    where: { revokedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!credential) throw new NotConnectedError()

  const refreshToken = unseal({
    ciphertext: credential.refreshTokenEnc,
    iv: credential.iv,
    authTag: credential.authTag,
  })

  const { accessToken, expiryDate } = await refreshAccessToken(refreshToken)
  cached = { token: accessToken, expiresAt: expiryDate ?? Date.now() + 3_000_000 }
  return accessToken
}

export function clearTokenCache(): void {
  cached = null
}

export async function googleClients() {
  const token = await getAccessToken()
  return { drive: makeDriveClient(token), docs: makeDocsClient(token) }
}
