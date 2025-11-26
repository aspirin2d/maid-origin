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

type LiveGenerateResponse = {
  storyId: number;
  handler: string;
  response: {
    clips?: Array<{
      body?: unknown;
      face?: unknown;
      speech?: unknown;
    }>;
  };
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

test(
  "Live handler can be created and returns clip-based response",
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

    const uniqueSuffix = Math.random().toString(36).slice(2);
    const createPayload = {
      name: `E2E Live Story ${uniqueSuffix}`,
      handler: "live",
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

      const generateResponse = await fetch(`${baseUrl}/api/generate-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          storyId: createdStoryId,
          input: {
            type: "user_chat",
            data: {
              message: "测试直播事件：主播好！",
              username: "e2e-user",
              timestamp: Date.now(),
            },
          },
        }),
      });

      const generated =
        await expectJsonResponse<LiveGenerateResponse>(generateResponse);

      expect(generated.storyId).toBe(createdStoryId);
      expect(generated.handler).toBe("live");

      const clips = generated.response?.clips;
      expect(Array.isArray(clips)).toBe(true);
      expect(clips!.length).toBeGreaterThanOrEqual(1);
      expect(clips!.length).toBeLessThanOrEqual(3);

      for (const clip of clips!) {
        expect(typeof clip.body).toBe("string");
        expect(typeof clip.face).toBe("string");
        expect(typeof clip.speech).toBe("string");
      }
    } finally {
      if (createdStoryId) {
        await fetch(`${baseUrl}/api/delete-story`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ id: createdStoryId }),
        }).catch(() => undefined);
      }
    }
  },
  60_000,
);

test(
  "Live handler rejects invalid event payloads with validation error",
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

    const uniqueSuffix = Math.random().toString(36).slice(2);
    const createPayload = {
      name: `E2E Live Invalid Payload ${uniqueSuffix}`,
      handler: "live",
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
      createdStoryId = created.story?.id;
      expect(createdStoryId).toBeDefined();

      const generateResponse = await fetch(`${baseUrl}/api/generate-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          storyId: createdStoryId,
          input: {
            type: "user_chat",
            data: {
              // message is required; omitting should fail validation
              username: "e2e-user",
            },
          },
        }),
      });

      expect(generateResponse.status).toBe(400);
      const error = await generateResponse.json();
      expect(error).toHaveProperty("error");
    } finally {
      if (createdStoryId) {
        await fetch(`${baseUrl}/api/delete-story`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ id: createdStoryId }),
        }).catch(() => undefined);
      }
    }
  },
  60_000,
);
