import { expect, test } from "vitest";

import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

type LiveResponsePayload = {
  storyId: number;
  handler: string;
  response?: {
    clips: Array<{ body: string; face: string; speech: string }>;
  };
};

async function expectJsonResponse<T>(
  response: Response,
  expectedStatus = 200,
): Promise<T> {
  if (response.status !== expectedStatus) {
    const errorBody = await response.text().catch(() => "<unable to read body>");
    throw new Error(
      `Request failed with ${response.status} ${response.statusText}: ${errorBody}`,
    );
  }
  return (await response.json()) as T;
}

test(
  "live handler generates clips for a user_chat event",
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

    const createPayload = {
      name: `E2E Live Story ${Date.now()}`,
      handler: "live",
    };

    const createResponse = await fetch(`${baseUrl}/api/create-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(createPayload),
    });
    const created = await expectJsonResponse<{ story?: { id: number } }>(
      createResponse,
      201,
    );

    expect(created.story).toBeTruthy();
    const storyId = created.story!.id;

    try {
      const generateResponse = await fetch(`${baseUrl}/api/generate-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          storyId,
          input: {
            type: "user_chat",
            data: {
              message: "小夜，今晚直播唱什么？",
            },
          },
        }),
      });

      const generated =
        await expectJsonResponse<LiveResponsePayload>(generateResponse);

      expect(generated.storyId).toBe(storyId);
      expect(generated.handler).toBe("live");
      expect(generated.response?.clips?.length).toBeGreaterThan(0);

      const firstClip = generated.response?.clips?.[0];
      expect(firstClip?.body).toBeTruthy();
      expect(firstClip?.face).toBeTruthy();
      expect(firstClip?.speech).toBeTruthy();
    } finally {
      await fetch(`${baseUrl}/api/delete-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ id: storyId }),
      }).catch(() => undefined);
    }
  },
  60_000,
);

test(
  "live handler rejects invalid live event input",
  async () => {
    const token = await loginAndGetBearerToken();
    const baseUrl = getApiBaseUrl();
    const jsonHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    } as const;

    const createResponse = await fetch(`${baseUrl}/api/create-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        name: `E2E Live Invalid ${Date.now()}`,
        handler: "live",
      }),
    });

    const created = await expectJsonResponse<{ story?: { id: number } }>(
      createResponse,
      201,
    );
    const storyId = created.story?.id;
    expect(typeof storyId).toBe("number");

    const invalidInputs = [
      { storyId, input: { type: "user_chat" } }, // missing data
      { storyId, input: { type: "gift_event", data: { username: "A" } } }, // missing required gift fields
      { storyId, input: { type: "unknown_event", data: {} } }, // unknown discriminator
    ];

    try {
      for (const payload of invalidInputs) {
        const response = await fetch(`${baseUrl}/api/generate-story`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(400);
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown;
        };
        expect(body.error).toBeTruthy();
      }
    } finally {
      if (storyId) {
        await fetch(`${baseUrl}/api/delete-story`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ id: storyId }),
        }).catch(() => undefined);
      }
    }
  },
  30_000,
);
