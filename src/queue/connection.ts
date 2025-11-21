import * as IORedisModule from "ioredis";
import { env } from "../env.ts";

// Handle both default and named exports
const IORedis = (IORedisModule as any).default || IORedisModule;

/**
 * Redis connection for BullMQ
 * Shared across queues and workers
 */
export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

/**
 * Graceful shutdown handler
 */
export async function closeRedisConnection() {
  await redisConnection.quit();
}
