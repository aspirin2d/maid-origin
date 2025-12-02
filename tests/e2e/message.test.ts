import { expect, test } from "vitest";

import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

type MessageRecord = {
  id: number;
  storyId: number;
  contentType: "query" | "response";
  createdAt: number;
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

async function createStory(
  baseUrl: string,
  headers: Record<string, string>,
  name: string,
): Promise<number> {
  const response = await fetch(`${baseUrl}/api/create-story`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, handler: "simple" }),
  });
  const payload = await expectJsonResponse<{ story?: { id: number } }>(
    response,
    201,
  );
  expect(payload.story, "Create response must include a story").toBeTruthy();
  return payload.story!.id;
}

async function generateStory(
  baseUrl: string,
  headers: Record<string, string>,
  storyId: number,
  question: string,
) {
  const response = await fetch(`${baseUrl}/api/generate-story`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      storyId,
      input: { question },
    }),
  });
  await expectJsonResponse(response);
}

test("list-messages returns newest messages for a story", async () => {
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

  const storyId = await createStory(
    baseUrl,
    jsonHeaders,
    `E2E Messages Story ${Date.now()}`,
  );

  try {
    await generateStory(
      baseUrl,
      jsonHeaders,
      storyId,
      "First exchange to seed messages",
    );
    await generateStory(
      baseUrl,
      jsonHeaders,
      storyId,
      "Second exchange should appear above the first",
    );

    const response = await fetch(
      `${baseUrl}/api/list-messages?storyId=${storyId}`,
      {
        headers: authHeaders,
      },
    );

    const payload = await expectJsonResponse<{ messages?: MessageRecord[] }>(
      response,
    );

    expect(payload.messages?.length).toBe(4);
    expect(
      payload.messages?.every((m) => m.storyId === storyId),
      "All returned messages should belong to the requested story",
    ).toBe(true);

    const createdAts = payload.messages!.map((m) => m.createdAt);
    const sortedByCreatedAt = [...createdAts].sort((a, b) => b - a);
    expect(createdAts).toEqual(sortedByCreatedAt);

    const queries = payload.messages!.filter((m) => m.contentType === "query");
    const responses = payload.messages!.filter(
      (m) => m.contentType === "response",
    );
    expect(queries.length).toBe(2);
    expect(responses.length).toBe(2);
  } finally {
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);

    await fetch(`${baseUrl}/api/prune-message`, {
      method: "POST",
      headers: authHeaders,
    }).catch(() => undefined);
  }
}, 30_000);

test("list-messages supports pagination and explicit sorting", async () => {
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

  const storyId = await createStory(
    baseUrl,
    jsonHeaders,
    `E2E Messages Paging ${Date.now()}`,
  );

  try {
    const prompts = [
      "First paging run",
      "Second paging run",
      "Third paging run",
    ];
    for (const prompt of prompts) {
      await generateStory(baseUrl, jsonHeaders, storyId, prompt);
    }

    const baseParams = new URLSearchParams({
      storyId: String(storyId),
      sortBy: "id",
      sortDirection: "asc",
    });

    const fullList = await fetch(
      `${baseUrl}/api/list-messages?${baseParams.toString()}`,
      { headers: authHeaders },
    );
    const fullPayload = await expectJsonResponse<{
      messages?: MessageRecord[];
    }>(fullList);
    const fullIds = fullPayload.messages?.map((m) => m.id) ?? [];

    expect(fullIds.length).toBe(6); // three generations produce query+response pairs

    const pagedParams = new URLSearchParams({
      ...Object.fromEntries(baseParams.entries()),
      limit: "3",
      offset: "1",
    });
    const pagedList = await fetch(
      `${baseUrl}/api/list-messages?${pagedParams.toString()}`,
      { headers: authHeaders },
    );
    const pagedPayload = await expectJsonResponse<{
      messages?: MessageRecord[];
    }>(pagedList);

    const pagedIds = pagedPayload.messages?.map((m) => m.id) ?? [];
    expect(pagedIds).toEqual(fullIds.slice(1, 4));

    const sortedPagedIds = [...pagedIds].sort((a, b) => a - b);
    expect(pagedIds).toEqual(sortedPagedIds);
  } finally {
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);

    await fetch(`${baseUrl}/api/prune-message`, {
      method: "POST",
      headers: authHeaders,
    }).catch(() => undefined);
  }
}, 30_000);
