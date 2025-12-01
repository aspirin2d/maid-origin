import { expect, test } from "vitest";
import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

type StoryRecord = {
  id: number;
  name: string;
  handler: string;
};

type StoryResponse = {
  story?: StoryRecord;
};

type StoriesListResponse = {
  stories?: StoryRecord[];
};

async function expectJsonResponse<T>(
  response: Response,
  expectedStatus = 200,
): Promise<T> {
  if (response.status !== expectedStatus) {
    const errorBody = await response
      .text()
      .catch(() => "<unable to read body>");
    console.log(errorBody);
    throw new Error(
      `Request failed with ${response.status} ${response.statusText}: ${errorBody}`,
    );
  }
  return (await response.json()) as T;
}

test("authenticated user can complete a story lifecycle", async () => {
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

  const uniqueSuffix = Math.random().toString(36).slice(2);
  const createPayload = {
    name: `E2E Story ${uniqueSuffix}`,
    handler: `handler-${uniqueSuffix}`,
  };

  let createdStoryId: number | undefined;

  try {
    const createResponse = await fetch(`${baseUrl}/api/create-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(createPayload),
    });
    const created = await expectJsonResponse<StoryResponse>(
      createResponse,
      201,
    );
    expect(created.story, "Create response must include a story").toBeTruthy();
    createdStoryId = created.story!.id;
    expect(typeof createdStoryId).toBe("number");

    const getResponse = await fetch(
      `${baseUrl}/api/get-story?id=${createdStoryId}`,
      {
        headers: authHeaders,
      },
    );

    const fetched = await expectJsonResponse<StoryResponse>(getResponse);

    expect(fetched.story?.id).toBe(createdStoryId);
    expect(fetched.story?.name).toBe(createPayload.name);

    const updatePayload = {
      id: createdStoryId,
      data: {
        name: `${createPayload.name} Updated`,
        handler: `${createPayload.handler}-updated`,
      },
    };
    const updateResponse = await fetch(`${baseUrl}/api/update-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(updatePayload),
    });
    const updated = await expectJsonResponse<StoryResponse>(updateResponse);
    expect(updated.story?.name).toBe(updatePayload.data.name);
    expect(updated.story?.handler).toBe(updatePayload.data.handler);

    const listResponse = await fetch(`${baseUrl}/api/list-stories?limit=20`, {
      headers: authHeaders,
    });
    const list = await expectJsonResponse<StoriesListResponse>(listResponse);
    const foundInList = list.stories?.some(
      (story) =>
        story.id === createdStoryId &&
        story.name === updatePayload.data.name &&
        story.handler === updatePayload.data.handler,
    );
    expect(foundInList).toBe(true);

    const deleteResponse = await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: createdStoryId }),
    });
    await expectJsonResponse<StoryResponse>(deleteResponse);
    createdStoryId = undefined;

    const confirmResponse = await fetch(
      `${baseUrl}/api/get-story?id=${updatePayload.id}`,
      {
        headers: authHeaders,
      },
    );
    expect(confirmResponse.status).toBe(404);
  } finally {
    if (createdStoryId) {
      await fetch(`${baseUrl}/api/delete-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ id: createdStoryId }),
      }).catch(() => undefined);
    }
  }
}, 30_000);

test("stories listing respects limit, offset, and sorting", async () => {
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

  const uniquePrefix = `E2E Paginated Story ${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const createdStories: StoryRecord[] = [];

  try {
    for (let i = 0; i < 3; i++) {
      const createResponse = await fetch(`${baseUrl}/api/create-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: `${uniquePrefix} #${i + 1}`,
          handler: `${uniquePrefix}-handler-${i + 1}`,
        }),
      });
      const created = await expectJsonResponse<StoryResponse>(
        createResponse,
        201,
      );
      expect(
        created.story,
        "Create response must include a story",
      ).toBeTruthy();
      createdStories.push(created.story!);
    }

    const expectedDescIds = [...createdStories]
      .map((story) => story.id)
      .sort((a, b) => b - a);

    const descParams = new URLSearchParams({
      sortBy: "id",
      sortDirection: "desc",
      limit: String(createdStories.length),
    });
    const descResponse = await fetch(
      `${baseUrl}/api/list-stories?${descParams.toString()}`,
      { headers: authHeaders },
    );
    const descList =
      await expectJsonResponse<StoriesListResponse>(descResponse);
    expect(descList.stories?.length).toBe(createdStories.length);
    expect(descList.stories?.map((story) => story.id)).toEqual(expectedDescIds);

    const offsetParams = new URLSearchParams({
      sortBy: "id",
      sortDirection: "desc",
      limit: "1",
      offset: "1",
    });
    const offsetResponse = await fetch(
      `${baseUrl}/api/list-stories?${offsetParams.toString()}`,
      { headers: authHeaders },
    );
    const offsetList =
      await expectJsonResponse<StoriesListResponse>(offsetResponse);
    expect(offsetList.stories?.length).toBe(1);
    expect(offsetList.stories?.[0]?.id).toBe(expectedDescIds[1]);

    const offsetTwoParams = new URLSearchParams({
      sortBy: "id",
      sortDirection: "desc",
      limit: "1",
      offset: "2",
    });
    const offsetTwoResponse = await fetch(
      `${baseUrl}/api/list-stories?${offsetTwoParams.toString()}`,
      { headers: authHeaders },
    );
    const offsetTwoList =
      await expectJsonResponse<StoriesListResponse>(offsetTwoResponse);
    expect(offsetTwoList.stories?.length).toBe(1);
    expect(offsetTwoList.stories?.[0]?.id).toBe(expectedDescIds[2]);
  } finally {
    for (const story of createdStories) {
      await fetch(`${baseUrl}/api/delete-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ id: story.id }),
      }).catch(() => undefined);
    }
  }
}, 30_000);

test("authenticated user can generate a story response", async () => {
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

  const createResponse = await fetch(`${baseUrl}/api/create-story`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      name: `E2E Generate Story ${Date.now()}`,
      handler: "simple",
    }),
  });
  const created = await expectJsonResponse<StoryResponse>(createResponse, 201);
  expect(created.story, "Create response must include a story").toBeTruthy();

  const storyId = created.story!.id;
  try {
    const generateResponse = await fetch(`${baseUrl}/api/generate-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        storyId,
        input: { question: "What is result of '1+9' ?" },
      }),
    });

    const generated = await expectJsonResponse<{
      storyId: number;
      handler: string;
      response?: { answer: string };
    }>(generateResponse);

    expect(generated.storyId).toBe(storyId);
    expect(generated.handler).toBe("simple");
    expect(generated.response?.answer).toBeTruthy();
    expect(typeof generated.response?.answer).toBe("string");
    expect(generated.response?.answer).contains("10");
  } finally {
    await fetch(`${baseUrl}/api/delete-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: storyId }),
    }).catch(() => undefined);
  }
}, 30_000);

test("generate-story returns 404 for an unknown story", async () => {
  const token = await loginAndGetBearerToken();
  const baseUrl = getApiBaseUrl();
  const jsonHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  } as const;

  // Pick a very large id to avoid collisions with any seeded data.
  const nonexistentStoryId = 9_000_000 + Math.floor(Math.random() * 1_000_000);

  const response = await fetch(`${baseUrl}/api/generate-story`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      storyId: nonexistentStoryId,
      input: { question: "Does this story exist?" },
    }),
  });

  expect(response.status).toBe(404);
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  expect(body.error).toMatch(/not found/i);
}, 10_000);
