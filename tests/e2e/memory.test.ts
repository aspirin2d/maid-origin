import { expect, test } from "vitest";

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

test(
  "memories are extracted after generating a story",
  async () => {
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
    const initialMemories = await expectJsonResponse<MemoriesResponse>(
      listInitial,
    );
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

      // Memory extraction is asynchronous; poll until we observe new memories.
      const maxAttempts = 20; // ~30s with 1.5s backoff
      let latestMemories: MemoryRecord[] | undefined;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await wait(1500);
        const list = await fetch(`${baseUrl}/api/list-memories`, {
          headers: authHeaders,
        });
        const payload =
          await expectJsonResponse<MemoriesResponse>(list).catch(() => null);
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
      expect(newestMemory?.content, "Extracted memory should have content").toBeTruthy();
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
  },
  60_000,
);
