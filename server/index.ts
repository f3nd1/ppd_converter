import { createApp } from './app.ts'
import { applyPragmas } from './lib/db.ts'
import { capabilities, env } from './lib/env.ts'
import { log } from './lib/logger.ts'
import { BASE_PATH } from './lib/session.ts'

// The entry point, and nothing else. It ALWAYS listens.
//
// This used to guard the listen() behind
// `import.meta.url === "file://" + process.argv[1]` so that a test could import
// createApp() without binding a port. That broke under PM2: fork mode launches
// its own wrapper script, so process.argv[1] is PM2's file rather than this
// one, the check failed, listen() was never called, and the process exited
// cleanly — a crash loop with completely empty logs. It only ever worked
// because it was started directly by hand.
//
// createApp() now lives in app.ts, so anything that wants the app without a
// port imports that instead. No detection to get wrong.

applyPragmas()

createApp().listen(env.PORT, env.HOST, () => {
  log.info('ppd_converter started', {
    url: `http://${env.HOST}:${env.PORT}${BASE_PATH}/`,
    capabilities: capabilities(),
  })
})
