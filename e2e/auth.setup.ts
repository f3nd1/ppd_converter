import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { sealData } from 'iron-session'
import { test as setup } from '@playwright/test'

// Signs the E2E run in WITHOUT adding any bypass to the application.
//
// There is deliberately no test-only auth backdoor in the server: a bypass
// gated on NODE_ENV is one misconfigured environment variable away from being a
// production hole. Instead this seals a genuine session cookie with the same
// secret the server uses, so the real session decryption, expiry and
// account-allowlist checks all still run against it.

const SESSION_SECRET = 'e2e-session-secret-at-least-32-characters-long'
const EMAIL = 'felix@unitedceres.edu.sg'
const PORT = 4021

setup('authenticate', async () => {
  const sealed = await sealData(
    { email: EMAIL, issuedAt: Date.now() },
    { password: SESSION_SECRET, ttl: 60 * 60 * 12 },
  )

  writeFileSync(
    path.join(process.cwd(), 'e2e', '.auth.json'),
    JSON.stringify({
      cookies: [
        {
          name: 'ppd_session',
          value: sealed,
          domain: '127.0.0.1',
          path: '/ppd_converter',
          expires: Math.floor(Date.now() / 1000) + 43200,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  )
  void PORT
})
