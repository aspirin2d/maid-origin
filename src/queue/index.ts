/**
 * Queue module for background job processing
 *
 * This module provides:
 * - Memory extraction queue with debouncing
 * - Worker to process extraction jobs
 * - Job status monitoring
 */

export { memoryQueue, memoryQueueEvents } from "./memory-queue.ts";
export {
  debounceMemoryExtraction,
  triggerMemoryExtraction,
  getMemoryExtractionStatus,
} from "./memory-queue.ts";
export { memoryWorker, closeMemoryWorker } from "./memory-worker.ts";
export { redisConnection, closeRedisConnection } from "./connection.ts";
export { MEMORY_QUEUE_CONFIG } from "./config.ts";
