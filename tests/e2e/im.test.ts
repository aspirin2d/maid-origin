import { expect, test } from "vitest";

import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

type IMResponsePayload = {
  storyId: number;
  handler: string;
  response?: {
    responseType: "textchat" | "image" | "task" | "busy" | "blocked" | "error";
    text: string | null;
    emotion: string | null;
    affectionChange: number | null;
    moodChange: number | null;
    energyChange: number | null;
    imageKey: string | null;
    taskType: string | null;
    taskDelaySeconds: number | null;
    taskContent: string | null;
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

const allowedResponseTypes = [
  "textchat",
  "image",
  "task",
  "busy",
  "blocked",
  "error",
] as const;

test(
  "im handler returns structured response for textchat input",
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
      name: `E2E IM Story ${Date.now()}`,
      handler: "im",
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

    expect(created.story, "Create response must include a story").toBeTruthy();

    const storyId = created.story?.id;
    expect(typeof storyId).toBe("number");

    try {
      const generateResponse = await fetch(`${baseUrl}/api/generate-story`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          storyId,
          input: {
            type: "textchat",
            message: "嘿 Ria，今天心情不错，聊聊你的训练计划吧？",
          },
        }),
      });

      const generated =
        await expectJsonResponse<IMResponsePayload>(generateResponse);

      expect(generated.storyId).toBe(storyId);
      expect(generated.handler).toBe("im");
      expect(generated.response, "Response payload is required").toBeTruthy();

      const payload = generated.response!;
      expect(allowedResponseTypes).toContain(payload.responseType);
      expect(payload.text === null || typeof payload.text === "string").toBe(true);
      expect(
        payload.emotion === null || typeof payload.emotion === "string",
      ).toBe(true);
      expect(
        payload.affectionChange === null ||
          typeof payload.affectionChange === "number",
      ).toBe(true);
      expect(
        payload.moodChange === null || typeof payload.moodChange === "number",
      ).toBe(true);
      expect(
        payload.energyChange === null ||
          typeof payload.energyChange === "number",
      ).toBe(true);
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
  60_000,
);

test(
  "im handler rejects invalid payloads before calling the model",
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

    const createResponse = await fetch(`${baseUrl}/api/create-story`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        name: `E2E IM Validation ${Date.now()}`,
        handler: "im",
      }),
    });

    const created = await expectJsonResponse<{ story?: { id: number } }>(
      createResponse,
      201,
    );
    const storyId = created.story?.id;

    expect(storyId, "Create response must include a story id").toBeTruthy();

    const invalidInputs = [
      // missing message
      { storyId, input: { type: "textchat" } },
      // command missing name
      { storyId, input: { type: "command" } },
      // wrong type for command field
      { storyId, input: { type: "command", command: 123 } },
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
        expect(body.error, "Error details should be returned for invalid input").toBeTruthy();
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
