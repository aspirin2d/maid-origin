import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { extractMemory } from "../memory/extraction.ts";
import { env } from "../env.ts";

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const extractionQueue = new Queue("memory-extraction-queue", {
  connection,
});

const extractionWorker = new Worker(
  "memory-extraction",
  async (job) => {
    await extractMemory(job.data.uid);
  },
  {
    connection,
  },
);

extractionWorker.on("active", (job) => {
  console.log(`Extraction worker started processing job ${job.id}`);
});

extractionWorker.on("completed", (job) => {
  console.log(`Extraction worker completed job ${job.id}`);
});

export async function addExtractionJob(uid: string) {
  extractionQueue.add("memory-extraction", uid, {
    deduplication: {
      id: uid + "-extraction",
      ttl: env.isTest ? 1000 : 60_000,
      extend: true,
    },
    delay: env.isTest ? 1000 : 60_000,
  });
}
