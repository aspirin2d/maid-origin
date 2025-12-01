import { Queue, Worker } from "bullmq";
import { extractMemory } from "../memory/extraction.ts";
import { env } from "../env.ts";

const QUEUE_NAME = "memory-extraction";
const extractionQueue = new Queue(QUEUE_NAME, {
  connection: {
    url: env.REDIS_URL,
  },
});
const extractionWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    await extractMemory(job.data.uid);
  },
  { connection: { url: env.REDIS_URL }, concurrency: 5 },
);

extractionWorker.on("active", (job) => {
  console.log(`Extraction worker started processing job ${job.id}`);
});

extractionWorker.on("error", (error) => {
  console.log(`Extraction worker error: ${error.message}`);
});

extractionWorker.on("completed", (job) => {
  console.log(`Extraction worker completed job ${job.id}`);
});

export async function addExtractionJob(uid: string) {
  await extractionQueue.add(
    QUEUE_NAME,
    { uid },
    {
      // debounce mode
      deduplication: {
        id: uid + "-extraction",
        ttl: env.isProduction ? 900_200 : 20_200, // in production 15m, otherwise 20s
        extend: true,
        replace: true,
      },
      delay: env.isProduction ? 900_000 : 20_000,
    },
  );
}
