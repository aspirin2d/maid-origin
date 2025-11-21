import { env } from "../env.ts";

/**
 * Memory extraction queue configuration
 */
export const MEMORY_QUEUE_CONFIG = {
  // Queue name
  queueName: "memory-extraction",

  // Debounce delay: wait this long after last message before extracting
  debounceDelay: env.isTest ? 100 : 30000, // 100ms in tests, 30s in production

  // Max wait: even if messages keep coming, extract after this long
  maxWait: env.isTest ? 500 : 300000, // 500ms in tests, 5 minutes in production

  // Worker concurrency: max parallel extractions
  concurrency: 5,

  // Rate limit: max extractions per second
  rateLimit: {
    max: 10,
    duration: 1000,
  },

  // Deduplication options for debounce mode
  getDeduplicationOptions: (debounceDelay: number) => ({
    id: "", // Will be set per-job
    ttl: debounceDelay, // TTL matches delay for debounce behavior
    extend: true, // Extends TTL on each new attempt
    replace: true, // Replaces job data with latest
  }),

  // Job options
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100,
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
} as const;
