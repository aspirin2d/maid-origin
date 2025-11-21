import { Worker, Job } from "bullmq";
import { redisConnection } from "./connection.ts";
import { MEMORY_QUEUE_CONFIG } from "./config.ts";
import { extractMemory } from "../memory/extraction.ts";

/**
 * Memory extraction worker
 *
 * Processes memory extraction jobs from the queue.
 * Each job contains a userId and triggers the full extraction pipeline.
 */
export const memoryWorker = new Worker(
  MEMORY_QUEUE_CONFIG.queueName,
  async (job: Job<{ userId: string }>) => {
    const { userId } = job.data;

    console.log(
      `[Worker] Starting memory extraction for user ${userId} (job ${job.id})`,
    );

    // Update progress
    await job.updateProgress(10);

    try {
      // Run the extraction
      const stats = await extractMemory(userId);

      await job.updateProgress(100);

      console.log(
        `[Worker] Completed memory extraction for user ${userId}:`,
        stats,
      );

      return stats;
    } catch (error) {
      console.error(
        `[Worker] Failed memory extraction for user ${userId}:`,
        error,
      );
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: MEMORY_QUEUE_CONFIG.concurrency,
    limiter: MEMORY_QUEUE_CONFIG.rateLimit,
  },
);

// Event listeners
memoryWorker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

memoryWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

memoryWorker.on("error", (err) => {
  console.error("[Worker] Worker error:", err);
});

// Graceful shutdown
export async function closeMemoryWorker() {
  console.log("[Worker] Closing memory worker...");
  await memoryWorker.close();
  console.log("[Worker] Memory worker closed");
}
