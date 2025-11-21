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
 * Debounce memory extraction for a user using BullMQ native deduplication
 *
 * This function uses BullMQ's native deduplication feature in debounce mode.
 * When called multiple times for the same user within the debounce delay,
 * BullMQ automatically extends the TTL and replaces the job data with the latest.
 *
 * If messages keep coming and we exceed maxWait, the job is forced to execute
 * immediately to prevent infinite debouncing.
 *
 * @param userId - The user ID to extract memories for
 * @returns Status of the debounce operation
 */
export async function debounceMemoryExtraction(userId: string) {
  const deduplicationId = `extract-${userId}`;
  const jobId = deduplicationId;

  try {
    // Check if there's an existing job being deduplicated
    const existingJobId = await memoryQueue.getDeduplicationJobId(
      deduplicationId,
    );

    if (existingJobId) {
      const existingJob = await memoryQueue.getJob(existingJobId);

      if (existingJob) {
        const state = await existingJob.getState();

        // If already processing, don't interrupt
        if (state === "active") {
          return {
            status: "processing" as const,
            jobId: existingJob.id,
          };
        }

        // Check if we've been debouncing too long (maxWait protection)
        const firstQueued = existingJob.timestamp;
        const now = Date.now();

        if (now - firstQueued > MEMORY_QUEUE_CONFIG.maxWait) {
          // Remove deduplication key to allow immediate execution
          await memoryQueue.removeDeduplicationKey(deduplicationId);

          // Add job without delay for immediate execution
          const immediateJob = await memoryQueue.add(
            "extract-memory",
            { userId },
            {
              jobId: `${jobId}-immediate-${Date.now()}`,
              priority: 1,
            },
          );

          return {
            status: "max_wait_reached" as const,
            jobId: immediateJob.id,
          };
        }
      }
    }

    // Add job with native deduplication in debounce mode
    // BullMQ will automatically handle extending TTL and replacing data
    const deduplicationOptions = MEMORY_QUEUE_CONFIG.getDeduplicationOptions(
      MEMORY_QUEUE_CONFIG.debounceDelay,
    );

    const job = await memoryQueue.add(
      "extract-memory",
      { userId },
      {
        jobId,
        delay: MEMORY_QUEUE_CONFIG.debounceDelay,
        deduplication: {
          ...deduplicationOptions,
          id: deduplicationId,
        },
      },
    );

    return {
      status: "debounced" as const,
      jobId: job.id ?? jobId,
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
