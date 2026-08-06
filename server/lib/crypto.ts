import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from './env.ts'

// AES-256-GCM for the stored Google refresh token. GCM rather than CBC so a
// tampered ciphertext fails to decrypt instead of silently yielding garbage —
// the auth tag is stored alongside and verified on every read.

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96 bits, the size GCM is specified for

export type Sealed = { ciphertext: string; iv: string; authTag: string }

function key(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY is not set — cannot store or read an OAuth refresh token.')
  }
  const buf = Buffer.from(env.ENCRYPTION_KEY, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${buf.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    )
  }
  return buf
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function unseal(sealed: Sealed): string {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
