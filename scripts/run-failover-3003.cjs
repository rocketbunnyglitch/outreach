/**
 * Failover web-instance launcher (pm2 app "outreach-2").
 *
 * Forces PORT=3003 IMPERATIVELY before requiring the Next.js standalone
 * server. This is deliberately not done via --env-file or the pm2 env
 * block: Node's --env-file does NOT override a PORT already present in the
 * environment, and `pm2 reload --update-env` propagates the deploy shell's
 * PORT=3001 into the process — which made this instance bind 3001 and
 * EADDRINUSE-crashloop against instance 1. Setting process.env.PORT here,
 * after --env-file has loaded all other secrets and before the server
 * reads PORT, is immune to every env/precedence quirk.
 */
process.env.PORT = "3003";
const path = require("node:path");
require(path.join(process.cwd(), ".next/standalone/server.js"));
