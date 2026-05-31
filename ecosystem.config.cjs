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
      // Live pm2 name is "outreach"; the prod tree lives at
      // /var/www/outreach (the box hosts both this engine and the
      // separate promoter/referral engine). The stale "crawl-engine"
      // values left over from the rename caused a fresh `pm2 start`
      // to look for /var/www/crawl-engine/.next/... and exit.
      name: "outreach",
      cwd: "/var/www/outreach",
      script: ".next/standalone/server.js",
      // Single instance for now. Cluster mode can be enabled when CPU-bound;
      // be careful about BullMQ workers if you do — duplicate workers will
      // process jobs N times.
      instances: 1,
      exec_mode: "fork",

      // Environment: PM2 doesn't load .env automatically. Use Node 20+
      // --env-file (we're on Node 22) so the standalone server.js sees
      // PORT, HOSTNAME, DATABASE_URL, NEXTAUTH_SECRET, etc. without a
      // dotenv import. Without this a fresh `pm2 start` ignored
      // /var/www/outreach/.env and Next defaulted to 0.0.0.0:3000 —
      // which collides with the sibling promoter engine and EADDRINUSE
      // crash-loops the outreach process.
      env: {
        NODE_ENV: "production",
      },
      node_args: ["--env-file=/var/www/outreach/.env"],

      // Restart policy.
      // Bumped 1G -> 2G after the VPS RAM upgrade (2GB -> 6GB). 1G was a
      // conservative cap for the 2GB box where promoter + system had to
      // coexist; on 6GB we leave ~3GB free even with both engines and
      // outreach-ws running. The real ceiling is concurrent SSE
      // subscribers (each ~1-2MB) — 2G fits hundreds of operators
      // without restarts. Drop back to 1G if multiple new services
      // land on the same box.
      max_memory_restart: "2G",
      max_restarts: 50,
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
      // Failover web instance. Identical to "outreach" but on PORT 3003.
      // nginx load-balances 3001+3003 with proxy_next_upstream, so a
      // reload/crash/hang of one instance never 502s the site. Safe to
      // run two instances: the BullMQ/cron workers are NOT embedded in
      // the web process (they're system-cron -> /api/cron/* HTTP endpoints
      // with SKIP LOCKED / idempotency), so two instances do not double
      // process jobs or double-send email. Realtime is Redis pub/sub.
      name: "outreach-2",
      cwd: "/var/www/outreach",
      script: "scripts/run-failover-3003.cjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      node_args: ["--env-file=/var/www/outreach/.env"],
      max_memory_restart: "2G",
      max_restarts: 50,
      min_uptime: "10s",
      restart_delay: 2000,
      out_file: "/var/log/crawl-engine/out-2.log",
      error_file: "/var/log/crawl-engine/err-2.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      kill_timeout: 10000,
      wait_ready: false,
      listen_timeout: 30000,
    },
    {
      name: "outreach-ws",
      script: "realtime/ws-server.mjs",
      cwd: "/var/www/outreach",
      instances: 1,
      exec_mode: "fork",
      // Bumped 300M -> 512M alongside the outreach app cap. The WS
      // server holds a small buffer per connected client; 512M handles
      // well over the operator count we'd ever realistically have.
      max_memory_restart: "512M",
      env: { NODE_ENV: "production", WS_PORT: "3002" },
      // PM2 env_file is not honored in this PM2 version; use Node 20+ --env-file
      // so NEXTAUTH_SECRET (read by the WS auth check) loads from /var/www/outreach/.env.
      node_args: ["--env-file=/var/www/outreach/.env"],
      error_file: "/var/log/outreach-ws-error.log",
      out_file: "/var/log/outreach-ws-out.log",
      time: true,
    },
  ],
};
