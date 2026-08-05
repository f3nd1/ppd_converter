// PM2 config for ppd_converter ONLY. It names no other process, so
// `pm2 start ecosystem.config.cjs` cannot affect the four apps already running
// on this box (admission-screening, ai_impact_builder, social_media_os,
// ucc_qa_hub). Never run `pm2 restart all` or `pm2 delete all`.
//
// Secrets are NOT in this file — the app reads them from .env at startup.
module.exports = {
  apps: [
    {
      name: 'ppd_converter',
      cwd: '/var/www/ppd_converter',
      script: 'dist/server/index.js',

      // fork + a single instance is required, not a default: cluster mode would
      // put several writers on one SQLite file and several migration workers on
      // one queue.
      instances: 1,
      exec_mode: 'fork',

      // The box has 1.9 GiB total with four other apps on it. Capping V8's heap
      // makes it collect rather than grow into their space, and
      // max_memory_restart means PM2 restarts THIS app if it ever misbehaves —
      // before the kernel OOM killer gets to pick a victim by score and takes
      // down someone else's app instead.
      node_args: '--max-old-space-size=192',
      max_memory_restart: '250M',

      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 4020,
      },

      // Project-local logs — nothing is shared with any other application.
      error_file: '/var/www/ppd_converter/logs/pm2-error.log',
      out_file: '/var/www/ppd_converter/logs/pm2-out.log',
      time: true,
    },
  ],
}
