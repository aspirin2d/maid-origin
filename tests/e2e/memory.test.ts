import { expect, test } from "vitest";
import { Job, Queue } from "bullmq";

import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

type MemoryRecord = { id: number; content?: string | null };
type MemoriesResponse = { memories?: MemoryRecord[] };
type StoryResponse = { story?: { id: number } };

async function expectJsonResponse<T>(
  response: Response,
  expectedStatus = 200,
): Promise<T> {
  if (response.status !== expectedStatus) {
    const body = await response.text().catch(() => "<unreadable body>");
    throw new Error(
      `Request failed with ${response.status} ${response.statusText}: ${body}`,
    );
  }
  return (await response.json()) as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const requireEnvVar = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be defined in tests/.env`);
  }
  return value;
};

const getSessionUrl = () => {
  const base = requireEnvVar("AUTH_API_URL");
  return base.endsWith("/") ? `${base}get-session` : `${base}/get-session`;
};

async function fetchCurrentUserId(token: string): Promise<string> {
  const response = await fetch(getSessionUrl(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const payload = await expectJsonResponse(response);
  const userId = (payload as any)?.user?.id;
  expect(
    typeof userId === "string" && userId.length > 0,
    "Auth session response must contain a user id",
  ).toBe(true);
  return userId as string;
}

async function getUserExtractionJobs(queue: Queue, uid: string) {
  const jobs = await queue.getJobs(["delayed", "waiting", "active"]);
  return jobs.filter((job) => job.data?.uid === uid);
}

async function clearUserExtractionState(queue: Queue, uid: string) {
  const jobs = await getUserExtractionJobs(queue, uid);
  await Promise.all(jobs.map((job) => job.remove()));
  await queue.removeDeduplicationKey(`${uid}Extraction`).catch(() => undefined);
}

async function waitForUserExtractionJob(
  queue: Queue,
  uid: string,
  attempts = 15,
  delayMs = 500,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const jobs = await getUserExtractionJobs(queue, uid);
    if (jobs.length > 0) {
      // pick the newest by timestamp so callers get the latest replacement
      return [...jobs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    }
    await wait(delayMs);
  }

  throw new Error("Expected to find an extraction job for the user");
}

test("memories are extracted after generating a story", async () => {
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

  // Baseline memory count so we can assert growth.
  const listInitial = await fetch(`${baseUrl}/api/list-memories`, {
    headers: authHeaders,
  });
  const initialMemories =
    await expectJsonResponse<MemoriesResponse>(listInitial);
  const initialCount = initialMemories.memories?.length ?? 0;

  // Create a fresh story that will produce extractable facts.
  const createStory = await fetch(`${baseUrl}/api/create-story`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      name: `E2E Memory Story ${Date.now()}`,
      handler: "simple",
    }),
  });
  const created = await expectJsonResponse<StoryResponse>(createStory, 201);
  expect(created.story, "Create response must include a story").toBeTruthy();

  const storyId = created.story!.id;

  try {
    // Ask a question rich with user facts so extraction has material.
    const generate = await fetch(`${baseUrl}/api/generate-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        storyId,
        input: {
          question:
            "Hi! I'm Casey, a 29 year old software engineer in Chicago who loves rock climbing and sushi.",
        },
      }),
    });

    await expectJsonResponse(generate); // only care that generation succeeded
    await wait(20_200); // wait for extraction started

    // Memory extraction is asynchronous; poll until we observe new memories.
    const maxAttempts = 20;
    let latestMemories: MemoryRecord[] | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await wait(2000);
      const list = await fetch(`${baseUrl}/api/list-memories`, {
        headers: authHeaders,
      });
      const payload = await expectJsonResponse<MemoriesResponse>(list).catch(
        () => null,
      );
      latestMemories = payload?.memories;
      if ((latestMemories?.length ?? 0) > initialCount) {
        break;
      }
    }

    expect(
      (latestMemories?.length ?? 0) > initialCount,
      "Memory count should increase after extraction",
    ).toBe(true);

    const newestMemory = latestMemories?.[0];
    expect(
      newestMemory?.content,
      "Extracted memory should have content",
    ).toBeTruthy();
    if (newestMemory?.content) {
      expect(typeof newestMemory.content).toBe("string");
    }
  } finally {
    // Clean up generated data to keep tests idempotent.
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);

    await fetch(`${baseUrl}/api/prune-memories`, {
      method: "POST",
      headers: jsonHeaders,
    }).catch(() => undefined);
  }
}, 60_000);

test("memory extraction jobs are debounced across rapid generations", async () => {
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

  const redisUrl = requireEnvVar("REDIS_URL");
  const queue = new Queue("memory-extraction", {
    connection: { url: redisUrl },
  });

  const userId = await fetchCurrentUserId(token);

  // ensure no leftover jobs affect our assertions
  await clearUserExtractionState(queue, userId);

  const createStory = await fetch(`${baseUrl}/api/create-story`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      name: `E2E Memory Debounce Story ${Date.now()}`,
      handler: "simple",
    }),
  });

  const created = await expectJsonResponse<StoryResponse>(createStory, 201);
  expect(created.story, "Create response must include a story").toBeTruthy();

  const storyId = created.story!.id;

  let firstJob: Job | undefined;
  let secondJob: Job | undefined;

  const triggerGeneration = async (question: string) => {
    const generate = await fetch(`${baseUrl}/api/generate-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        storyId,
        input: { question },
      }),
    });

    await expectJsonResponse(generate);
  };

  try {
    // kick off first generation to enqueue an extraction job
    await triggerGeneration(
      "First turn: just warming up the conversation for debounce testing.",
    );
    firstJob = await waitForUserExtractionJob(queue, userId);
    expect(firstJob, "First extraction job should exist").toBeTruthy();

    // second generation happens inside the debounce window
    await wait(5_000);
    const secondTriggerAt = Date.now();
    await triggerGeneration(
      "Second turn: should replace the pending extraction job and push it back.",
    );

    secondJob = await waitForUserExtractionJob(queue, userId);
    expect(secondJob, "Second extraction job should be present").toBeTruthy();

    // the earlier delayed job should have been replaced, not co-exist
    expect(secondJob!.id).not.toBe(firstJob!.id);

    const scheduledAt = (secondJob!.timestamp ?? 0) + (secondJob!.delay ?? 0);
    expect(
      scheduledAt >= secondTriggerAt + 19_000,
      `Expected debounce to push execution ~20s after last activity, got ${
        (scheduledAt - secondTriggerAt) / 1000
      }s`,
    ).toBe(true);

    const pendingJobs = await getUserExtractionJobs(queue, userId);
    expect(
      pendingJobs.length,
      "Only one extraction job should remain queued for the user",
    ).toBe(1);
    expect(pendingJobs[0].id).toBe(secondJob!.id);
  } finally {
    // Clean up generated data and queue state to keep tests idempotent.
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);

    await fetch(`${baseUrl}/api/prune-memories`, {
      method: "POST",
      headers: jsonHeaders,
    }).catch(() => undefined);

    await clearUserExtractionState(queue, userId).catch(() => undefined);
    await queue.close();
  }
}, 60_000);
