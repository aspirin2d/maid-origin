import { expect, test, beforeEach, afterEach } from "vitest";
import {
  memoryQueue,
  debounceMemoryExtraction,
  MEMORY_QUEUE_CONFIG,
} from "../../src/queue/index.ts";
import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

type StoryResponse = {
  story?: { id: number; handler: string; name: string };
};

type GenerateStoryResponse = {
  storyId: number;
  handler: string;
  response?: { answer: string };
};

type MemoryListResponse = {
  memories?: Array<{
    id: number;
    content: string | null;
    category: string | null;
  }>;
};

async function expectJsonResponse<T>(
  response: Response,
  expectedStatus = 200,
): Promise<T> {
  if (response.status !== expectedStatus) {
    const errorBody = await response
      .text()
      .catch(() => "<unable to read body>");
    throw new Error(
      `Request failed with ${response.status} ${response.statusText}: ${errorBody}`,
    );
  }
  return (await response.json()) as T;
}

async function waitForJobCompletion(
  jobId: string,
  timeoutMs: number = 5000,
): Promise<any> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const job = await memoryQueue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state === "completed") {
      return job.returnvalue;
    }

    if (state === "failed") {
      throw new Error(`Job ${jobId} failed: ${job.failedReason}`);
    }

    // Wait before checking again
    await new Promise((r) => setTimeout(r, 50));
  }

  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

async function getJobState(jobId: string): Promise<string | null> {
  const job = await memoryQueue.getJob(jobId);
  if (!job) return null;
  return await job.getState();
}

beforeEach(async () => {
  // Clean queue before each test
  await memoryQueue.drain();
  await memoryQueue.clean(0, 0);
});

afterEach(async () => {
  // Clean up after tests
  await memoryQueue.drain();
  await memoryQueue.clean(0, 0);
});

test("debounce creates delayed job on first call", async () => {
  const userId = "test-user-debounce-1";

  const result = await debounceMemoryExtraction(userId);

  expect(result.status).toBe("debounced");
  expect(result.jobId).toBe(`extract:${userId}`);

  // Check job is delayed
  const job = await memoryQueue.getJob(`extract:${userId}`);
  expect(job).toBeDefined();
  expect(await job?.getState()).toBe("delayed");
  expect(job?.opts.delay).toBe(MEMORY_QUEUE_CONFIG.debounceDelay);
});

test("debounce resets timer on subsequent calls", async () => {
  const userId = "test-user-debounce-2";

  // First call
  const result1 = await debounceMemoryExtraction(userId);
  expect(result1.status).toBe("debounced");

  const firstJob = await memoryQueue.getJob(`extract:${userId}`);
  const firstTimestamp = firstJob?.timestamp;

  // Wait a bit
  await new Promise((r) => setTimeout(r, 50));

  // Second call (should reset timer)
  const result2 = await debounceMemoryExtraction(userId);
  expect(result2.status).toBe("debounced");

  const secondJob = await memoryQueue.getJob(`extract:${userId}`);
  const secondTimestamp = secondJob?.timestamp;

  // Job should be recreated with newer timestamp
  expect(secondTimestamp).toBeGreaterThan(firstTimestamp!);
  expect(await secondJob?.getState()).toBe("delayed");
});

test("debounce does not interrupt active job", async () => {
  const userId = "test-user-debounce-3";

  // Create a job and simulate it being picked up by worker
  const job = await memoryQueue.add(
    "extract-memory",
    { userId },
    { jobId: `extract:${userId}` },
  );

  // Promote to active (simulate worker picking it up)
  await job.promote();

  // Try to debounce while active
  const result = await debounceMemoryExtraction(userId);

  expect(result.status).toBe("processing");
  expect(result.jobId).toBe(`extract:${userId}`);

  // Should still be the same job
  const currentJob = await memoryQueue.getJob(`extract:${userId}`);
  expect(currentJob?.id).toBe(job.id);
});

test("multiple rapid messages only trigger one extraction", async () => {
  const token = await loginAndGetBearerToken();
  const baseUrl = getApiBaseUrl();
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  } as const;
  const jsonHeaders = {
    ...authHeaders,
    "Content-Type": "application/json",
  } as const;

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storyPayload = {
    name: `Debounce Test Story ${uniqueSuffix}`,
    handler: "simple",
  };

  // Create story
  const createResponse = await fetch(`${baseUrl}/api/create-story`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(storyPayload),
  });
  const created = await expectJsonResponse<StoryResponse>(createResponse, 201);
  const storyId = created.story!.id;

  try {
    // Send multiple messages rapidly
    const messages = [
      "My name is Alice",
      "I love coffee",
      "I live in San Francisco",
    ];

    for (const question of messages) {
      await fetch(`${baseUrl}/api/generate-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ storyId, input: { question } }),
      });

      // Small delay between messages (less than debounce time)
      await new Promise((r) => setTimeout(r, 20));
    }

    // Check that only one delayed job exists
    const delayedJobs = await memoryQueue.getJobs(["delayed"]);
    expect(delayedJobs.length).toBe(1);

    const jobId = delayedJobs[0]?.id;
    expect(jobId).toBeDefined();
    console.log(`Waiting for job ${jobId} to complete...`);

    // Wait for the debounced job to complete
    const result = await waitForJobCompletion(jobId!, 2000);

    expect(result).toBeDefined();
    expect(result.messagesExtracted).toBeGreaterThan(0);
    expect(result.factsExtracted).toBeGreaterThan(0);

    // Verify memories were created
    const listResponse = await fetch(`${baseUrl}/api/list-memories`, {
      method: "GET",
      headers: authHeaders,
    });
    const memoryList = await expectJsonResponse<MemoryListResponse>(
      listResponse,
    );
    expect(memoryList.memories?.length ?? 0).toBeGreaterThan(0);

    console.log("Extracted memories:", memoryList.memories?.length);
  } finally {
    // Cleanup
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);

    await fetch(`${baseUrl}/api/delete-memories`, {
      method: "POST",
      headers: authHeaders,
    }).catch(() => undefined);
  }
}, 30_000); // 30 second timeout

test("extraction runs after debounce delay", async () => {
  const token = await loginAndGetBearerToken();
  const baseUrl = getApiBaseUrl();
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  } as const;
  const jsonHeaders = {
    ...authHeaders,
    "Content-Type": "application/json",
  } as const;

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storyPayload = {
    name: `Debounce Delay Test ${uniqueSuffix}`,
    handler: "simple",
  };

  // Create story
  const createResponse = await fetch(`${baseUrl}/api/create-story`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(storyPayload),
  });
  const created = await expectJsonResponse<StoryResponse>(createResponse, 201);
  const storyId = created.story!.id;

  try {
    // Send a message
    await fetch(`${baseUrl}/api/generate-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        storyId,
        input: { question: "I prefer tea over coffee" },
      }),
    });

    // Get the job ID
    const delayedJobs = await memoryQueue.getJobs(["delayed"]);
    expect(delayedJobs.length).toBe(1);

    const jobId = delayedJobs[0]?.id;
    expect(jobId).toBeDefined();

    // Job should be delayed initially
    const initialState = await getJobState(jobId!);
    expect(initialState).toBe("delayed");

    // Wait for debounce delay + processing time
    await new Promise((r) =>
      setTimeout(r, MEMORY_QUEUE_CONFIG.debounceDelay + 500),
    );

    // Job should now be completed or active
    const finalState = await getJobState(jobId!);
    expect(["completed", "active"]).toContain(finalState);

    console.log(`Job ${jobId} state: ${finalState}`);
  } finally {
    // Cleanup
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);

    await fetch(`${baseUrl}/api/delete-memories`, {
      method: "POST",
      headers: authHeaders,
    }).catch(() => undefined);
  }
}, 30_000);

test("job state transitions correctly", async () => {
  const userId = "test-user-transitions";

  // Create delayed job
  await debounceMemoryExtraction(userId);
  const jobId = `extract:${userId}`;

  let state = await getJobState(jobId);
  expect(state).toBe("delayed");

  // Promote to waiting
  const job = await memoryQueue.getJob(jobId);
  await job?.promote();

  state = await getJobState(jobId);
  expect(["waiting", "active"]).toContain(state);
});
