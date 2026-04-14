// PM2 ecosystem configuration for H4KKEN
// Usage:
//   pm2 start ecosystem.config.cjs          (starts prod only)
//   pm2 start ecosystem.config.cjs --only h4kken-dev
//   pm2 restart h4kken
//   pm2 logs h4kken

const path = require('node:path');

module.exports = {
  apps: [
    // ── Production server ─────────────────────────────────
    {
      name: 'h4kken',
      script: 'dist/server.js',
      interpreter: process.env.BUN_PATH || 'bun',
      cwd: __dirname,
      env: {
        PORT: 3000,
        // TURN credentials — set these in .env or override via PM2 env
        // Generate a secret with: openssl rand -hex 32
        TURN_SECRET: process.env.TURN_SECRET || '',
        TURN_REALM: process.env.TURN_REALM || '',
        TURN_PORT: '3478',
        TURN_TLS_PORT: '5349',
      },
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 5000,
      listen_timeout: 8000,
      autorestart: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(__dirname, 'logs/error.log'),
      out_file: path.join(__dirname, 'logs/out.log'),
    },

    // ── Development server (manual start only) ────────────
    {
      name: 'h4kken-dev',
      script: 'server.ts',
      interpreter: process.env.BUN_PATH || 'bun',
      interpreter_args: '--watch',
      cwd: __dirname,
      env: {
        PORT: 3001,
      },
      autorestart: false,
      watch: false,
    },
  ],
};
