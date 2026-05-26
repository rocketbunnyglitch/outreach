/**
 * Redis client (ioredis).
 *
 * Used by:
 *   - BullMQ for queues (Phase 5+)
 *   - Session caching where appropriate
 *   - Rate limiting per staff member
 *
 * Single client instance per process; ioredis multiplexes.
 */

import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

let _client: Redis | undefined;

export function getRedis(): Redis {
  if (!_client) {
    _client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: true,
      lazyConnect: false,
    });
    _client.on("error", (err) => {
      logger.error({ err }, "redis client emitted an error");
    });
    _client.on("connect", () => {
      logger.info("redis connected");
    });
  }
  return _client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const client = getRedis();
    // Wrap ping in an explicit timeout — ioredis retries connection forever
    // by default, which would hang the health endpoint when Redis is down.
    const result = await Promise.race<string | "timeout">([
      client.ping(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1500)),
    ]);
    return result === "PONG";
  } catch (err) {
    logger.warn({ err }, "redis ping failed");
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = undefined;
  }
}
