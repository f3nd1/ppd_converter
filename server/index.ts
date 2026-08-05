import { fileURLToPath } from 'node:url'
import path from 'node:path'
import express from 'express'
import helmet from 'helmet'

// Must match `base` in vite.config.ts and the nginx location block.
const BASE_PATH = '/ppd_converter'
const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4020)

// Resolved from the bundle's own location (dist/server/index.js) so the server
// works regardless of the directory PM2 happens to start it from.
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client')

const app = express()

// Trust the single nginx hop in front of us so req.protocol and req.ip reflect
// the real client rather than the proxy. Exactly one hop — not `true`, which
// would let a spoofed X-Forwarded-For through.
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Vite emits hashed <style> tags; no third-party origin is ever allowed.
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    // helmet defaults to SAMEORIGIN. Nothing should ever frame this app, and
    // CSP frame-ancestors above already says so for modern browsers — DENY
    // closes the same gap for anything that only understands this header.
    frameguard: { action: 'deny' },
    // HSTS is set by nginx for the whole host; duplicating it here would be
    // harmless but misleading about who owns the policy.
    hsts: false,
  }),
)

app.use(express.json({ limit: '1mb' }))

const api = express.Router()

api.get('/health', (_req, res) => {
  const mem = process.memoryUsage()
  res.json({
    ok: true,
    phase: 1,
    uptimeSeconds: Math.round(process.uptime()),
    // Surfaced deliberately: this box runs four other apps in 1.9 GiB, so the
    // app's own footprint needs to be checkable without shelling into the server.
    memory: {
      rssMb: +(mem.rss / 1024 / 1024).toFixed(1),
      heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(1),
    },
  })
})

app.use(`${BASE_PATH}/api`, api)

// index.html is served here for the base path itself; the splat below only has
// to cover deeper paths. Disabling `index` and relying on the splat alone 404s
// on /ppd_converter/ — the splat does not match the empty remainder.
app.use(BASE_PATH, express.static(clientDir))

// SPA fallback: any non-API path under the base path returns index.html so
// BrowserRouter can handle deep links (e.g. /ppd_converter/migration).
app.get(`${BASE_PATH}/*splat`, (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'))
})

app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`))

app.listen(PORT, HOST, () => {
  console.log(`ppd_converter listening on http://${HOST}:${PORT}${BASE_PATH}/`)
})
