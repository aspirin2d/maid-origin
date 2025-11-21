import { expect, test } from "vitest";

import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

type StoryResponse = {
  story?: { id: number; handler: string; name: string };
};

type GenerateStoryResponse = {
  storyId: number;
  handler: string;
  response?: { answer: string };
};

type MemoryExtractionStats = {
  factsExtracted: number;
  memoriesAdded: number;
  memoriesUpdated: number;
  messagesExtracted: number;
};

type MemoryExtractionResponse = {
  stats?: MemoryExtractionStats;
};

type MemoryDeleteResponse = {
  deleted: number;
};

type MemoryRecord = {
  id: number;
  content: string | null;
  category: string | null;
  importance: number | null;
  confidence: number | null;
  action: string | null;
  embedding?: number[] | null;
};

type MemoryListResponse = {
  memories?: MemoryRecord[];
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

test("user conversation can be converted into memories", async () => {
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
    name: `Memory Extraction Story ${uniqueSuffix}`,
    handler: "simple",
  };

  const createResponse = await fetch(`${baseUrl}/api/create-story`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(storyPayload),
  });
  const created = await expectJsonResponse<StoryResponse>(createResponse, 201);
  expect(created.story, "Create response must include a story").toBeTruthy();
  const storyId = created.story!.id;

  const conversationPrompts = [
    `I live in Portland, Oregon and my accountability code is ${uniqueSuffix}. Please confirm you captured it.`,
    `I prefer jasmine tea over coffee and I'm training for a 42-mile ultra marathon this winter.`,
  ];

  try {
    const sendConversationMessages = async (questions: string[]) => {
      for (const question of questions) {
        const generateResponse = await fetch(`${baseUrl}/api/generate-story`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            storyId,
            input: { question },
          }),
        });
        const generated =
          await expectJsonResponse<GenerateStoryResponse>(generateResponse);
        expect(generated.storyId).toBe(storyId);
        expect(generated.handler).toBe("simple");
        expect(generated.response?.answer).toBeTruthy();
      }
    };

    await sendConversationMessages(conversationPrompts);
    const extractionResponse = await fetch(`${baseUrl}/api/memory-extraction`, {
      method: "POST",
      headers: authHeaders,
    });
    const extraction =
      await expectJsonResponse<MemoryExtractionResponse>(extractionResponse);
    expect(extraction.stats, "Extraction must return stats").toBeTruthy();
    const stats = extraction.stats!;

    expect(stats.messagesExtracted).toBeGreaterThanOrEqual(
      conversationPrompts.length * 2,
    );
    expect(stats.factsExtracted).toBeGreaterThanOrEqual(1);
    expect(stats.memoriesAdded + stats.memoriesUpdated).toBeGreaterThanOrEqual(
      1,
    );

    const listParams = new URLSearchParams({
      limit: "20",
      sortBy: "updatedAt",
      sortDirection: "desc",
    });
    const listResponse = await fetch(
      `${baseUrl}/api/list-memories?${listParams.toString()}`,
      {
        method: "GET",
        headers: authHeaders,
      },
    );
    const memoryList =
      await expectJsonResponse<MemoryListResponse>(listResponse);
    let sanitizedMemories = (memoryList.memories ?? []).map(
      ({ embedding: _embedding, ...rest }) => rest,
    );
    console.log(
      "Memories after extraction 1:",
      JSON.stringify(sanitizedMemories, null, 2),
    );
    expect(memoryList.memories?.length ?? 0).toBeGreaterThanOrEqual(1);

    if ((memoryList.memories?.length ?? 0) >= 2) {
      const firstMemoryId = memoryList.memories?.[0]?.id;
      const offsetParams = new URLSearchParams({
        limit: "1",
        offset: "1",
        sortBy: "updatedAt",
        sortDirection: "desc",
      });
      const offsetResponse = await fetch(
        `${baseUrl}/api/list-memories?${offsetParams.toString()}`,
        {
          method: "GET",
          headers: authHeaders,
        },
      );
      const offsetList =
        await expectJsonResponse<MemoryListResponse>(offsetResponse);
      if (firstMemoryId && offsetList.memories?.[0]) {
        expect(offsetList.memories[0].id).not.toBe(firstMemoryId);
      }
    }

    const followupPrompts = [
      `Quick correction: I told you earlier that I live in Portland, but I actually moved to Seattle, Washington last week—please update that memory for me.`,
      `I'm planning a backpacking trip across Patagonia next May.`,
    ];
    await sendConversationMessages(followupPrompts);

    const secondExtractionResponse = await fetch(
      `${baseUrl}/api/memory-extraction`,
      {
        method: "POST",
        headers: authHeaders,
      },
    );
    const secondExtraction = await expectJsonResponse<MemoryExtractionResponse>(
      secondExtractionResponse,
    );
    const secondStats = secondExtraction.stats!;
    expect(secondStats.messagesExtracted).toBeGreaterThanOrEqual(
      followupPrompts.length * 2,
    );
    expect(secondStats.factsExtracted).toBeGreaterThanOrEqual(1);
    expect(secondStats.memoriesUpdated).toBeGreaterThanOrEqual(1); // update the live location
    expect(secondStats.memoriesAdded).toBeGreaterThanOrEqual(1);

    const secondListResponse = await fetch(
      `${baseUrl}/api/list-memories?${listParams.toString()}`,
      {
        method: "GET",
        headers: authHeaders,
      },
    );
    const secondMemoryList =
      await expectJsonResponse<MemoryListResponse>(secondListResponse);
    sanitizedMemories = (secondMemoryList.memories ?? []).map(
      ({ embedding: _embedding, ...rest }) => rest,
    );
    console.log(
      "Memories after extraction 2:",
      JSON.stringify(sanitizedMemories, null, 2),
    );

    const idleExtractionResponse = await fetch(
      `${baseUrl}/api/memory-extraction`,
      {
        method: "POST",
        headers: authHeaders,
      },
    );
    const idleExtraction = await expectJsonResponse<MemoryExtractionResponse>(
      idleExtractionResponse,
    );
    const idleStats = idleExtraction.stats!;
    expect(idleStats.messagesExtracted).toBe(0);
    expect(idleStats.factsExtracted).toBe(0);
    expect(idleStats.memoriesAdded).toBe(0);
    expect(idleStats.memoriesUpdated).toBe(0);
  } finally {
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);

    await fetch(`${baseUrl}/api/delete-memories`, {
      method: "POST",
      headers: authHeaders,
    })
      .then((response) => expectJsonResponse<MemoryDeleteResponse>(response))
      .catch(() => undefined);
  }
}, 120_000);
