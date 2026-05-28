/**
 * PM2 ecosystem file for the crawl engine.
 *
 * Used per DECISIONS.md#003 (PM2 chosen over systemd to match the existing
 * promoter-engine pattern on the same server).
 *
 * Start:    pm2 start ecosystem.config.cjs
 * Restart:  pm2 restart crawl-engine
 * Logs:     pm2 logs crawl-engine
 * Status:   pm2 status crawl-engine
 *
 * In production this runs from /var/www/crawl-engine after `pnpm install`
 * and `pnpm build` have produced the .next/standalone bundle.
 */

module.exports = {
  apps: [
    {
      name: "crawl-engine",
      cwd: "/var/www/crawl-engine",
      script: ".next/standalone/server.js",
      // Single instance for now. Cluster mode can be enabled when CPU-bound;
      // be careful about BullMQ workers if you do — duplicate workers will
      // process jobs N times.
      instances: 1,
      exec_mode: "fork",

      // Environment: PM2 doesn't load .env automatically. We load it at the
      // top of server code via dotenv, OR via a wrapper. Simpler: rely on
      // the user environment having .env vars exported, OR use --update-env
      // when restarting after .env changes. For now, document it.
      env: {
        NODE_ENV: "production",
      },

      // Restart policy.
      max_memory_restart: "1G",
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,

      // Logging — PM2 writes to ~/.pm2/logs/ by default.
      out_file: "/var/log/crawl-engine/out.log",
      error_file: "/var/log/crawl-engine/err.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Graceful shutdown: PM2 sends SIGINT then SIGKILL after the wait.
      // Next.js standalone handles SIGINT to drain in-flight requests.
      kill_timeout: 10000, // 10s for active requests + BullMQ workers to drain
      wait_ready: false,
      listen_timeout: 30000,
    },
    {
      name: "outreach-ws",
      script: "realtime/ws-server.mjs",
      cwd: "/var/www/outreach",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      env: { NODE_ENV: "production", WS_PORT: "3002" },
      env_file: ".env",
      error_file: "/var/log/outreach-ws-error.log",
      out_file: "/var/log/outreach-ws-out.log",
      time: true,
    },
  ],
};
