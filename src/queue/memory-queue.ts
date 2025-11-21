import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "./connection.ts";
import { MEMORY_QUEUE_CONFIG } from "./config.ts";

/**
 * Memory extraction queue
 */
export const memoryQueue = new Queue(MEMORY_QUEUE_CONFIG.queueName, {
  connection: redisConnection,
  defaultJobOptions: MEMORY_QUEUE_CONFIG.defaultJobOptions,
});

/**
 * Queue events for monitoring
 */
export const memoryQueueEvents = new QueueEvents(
  MEMORY_QUEUE_CONFIG.queueName,
  {
    connection: redisConnection,
  },
);

/**
 * Debounce memory extraction for a user
 *
 * This function queues a memory extraction job that will run after a delay.
 * If called multiple times for the same user, it removes the previous delayed
 * job and schedules a new one, effectively debouncing the extraction.
 *
 * @param userId - The user ID to extract memories for
 * @returns Status of the debounce operation
 */
export async function debounceMemoryExtraction(userId: string) {
  const jobId = `extract-${userId}`;

  try {
    // Get existing job if it exists
    const existingJob = await memoryQueue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();

      // If already processing, don't interrupt
      if (state === "active") {
        return {
          status: "processing" as const,
          jobId,
        };
      }

      // If delayed or waiting, check if we've been waiting too long
      if (state === "delayed" || state === "waiting") {
        const firstQueued = existingJob.timestamp; // When first added
        const now = Date.now();

        // If we've been debouncing for more than MAX_WAIT, let it run
        if (now - firstQueued > MEMORY_QUEUE_CONFIG.maxWait) {
          return {
            status: "max_wait_reached" as const,
            jobId,
          };
        }

        // Otherwise, reset the debounce timer by removing and re-adding
        await existingJob.remove();
      }
    }

    // Add new delayed job
    const job = await memoryQueue.add(
      "extract-memory",
      { userId },
      {
        jobId,
        delay: MEMORY_QUEUE_CONFIG.debounceDelay,
      },
    );

    return {
      status: "debounced" as const,
      jobId: job.id,
    };
  } catch (error) {
    console.error("Error debouncing memory extraction:", error);
    throw error;
  }
}

/**
 * Trigger immediate memory extraction (skip debounce)
 *
 * @param userId - The user ID to extract memories for
 * @returns Job ID
 */
export async function triggerMemoryExtraction(userId: string) {
  const jobId = `extract-${userId}-manual-${Date.now()}`;

  const job = await memoryQueue.add(
    "extract-memory",
    { userId },
    {
      jobId,
      priority: 1, // Higher priority than debounced jobs
    },
  );

  return { jobId: job.id };
}

/**
 * Get job status
 *
 * @param jobId - The job ID to check
 * @returns Job status information
 */
export async function getMemoryExtractionStatus(jobId: string) {
  const job = await memoryQueue.getJob(jobId);

  if (!job) {
    return { found: false as const };
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    found: true as const,
    jobId: job.id,
    state,
    progress,
    data: job.data,
    returnvalue: job.returnvalue,
  };
}
