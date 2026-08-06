import { fileURLToPath } from 'node:url'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { applyPragmas } from './lib/db.ts'
import { capabilities, env } from './lib/env.ts'
import { correlation, csrfGuard, errorHandler } from './lib/http.ts'
import { log } from './lib/logger.ts'
import { attachSession, BASE_PATH, requireAuth } from './lib/session.ts'
import { authRouter } from './routes/auth.ts'
import { criteriaRouter } from './routes/criteria.ts'
import { configRouter } from './routes/config.ts'
import { migrationRouter } from './routes/migration.ts'
import { reportsRouter } from './routes/reports.ts'
import { sourcesRouter } from './routes/sources.ts'

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client')

export function createApp() {
  const app = express()

  // Exactly one proxy hop (nginx). Not `true`, which would trust a spoofed
  // X-Forwarded-For from anyone who could reach the port.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          formAction: ["'self'"],
        },
      },
      frameguard: { action: 'deny' },
      // HSTS belongs to nginx, which owns TLS for the whole host.
      hsts: false,
    }),
  )

  app.use(correlation)
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(attachSession)

  const origins = [
    'https://apps.unitedceres.edu.sg',
    `http://127.0.0.1:${env.PORT}`,
    `http://localhost:${env.PORT}`,
    'http://localhost:5174',
  ]

  // Public: health and auth. Everything else requires the authorised account.
  const publicApi = express.Router()
  publicApi.get('/health', (_req, res) => {
    const mem = process.memoryUsage()
    res.json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      capabilities: capabilities(),
      memory: {
        rssMb: +(mem.rss / 1024 / 1024).toFixed(1),
        heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(1),
      },
    })
  })
  app.use(`${BASE_PATH}/api`, publicApi)
  app.use(`${BASE_PATH}/api/auth`, csrfGuard(origins), authRouter)

  const api = express.Router()
  api.use(csrfGuard(origins))
  api.use(requireAuth)
  api.use(criteriaRouter)
  api.use(sourcesRouter)
  api.use(configRouter)
  api.use(migrationRouter)
  api.use(reportsRouter)
  app.use(`${BASE_PATH}/api`, api)

  // index.html is served here for the base path itself; the splat below covers
  // deeper paths only — it does not match an empty remainder.
  app.use(BASE_PATH, express.static(clientDir))
  app.get(`${BASE_PATH}/*splat`, (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'))
  })
  app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`))

  app.use(errorHandler)
  return app
}

// Only listen when run directly, so tests can import createApp() without
// binding a port.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  applyPragmas()
  createApp().listen(env.PORT, env.HOST, () => {
    log.info('ppd_converter started', {
      url: `http://${env.HOST}:${env.PORT}${BASE_PATH}/`,
      capabilities: capabilities(),
    })
  })
}
