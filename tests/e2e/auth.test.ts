import { expect, test } from "vitest";

import { getApiBaseUrl, loginAndGetBearerToken } from "./helpers.ts";

test("authenticated user can fetch their profile via /api/user", async () => {
  const token = await loginAndGetBearerToken();
  const response = await fetch(`${getApiBaseUrl()}/api/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response
      .text()
      .catch(() => "<unable to read body>");
    throw new Error(
      `/api/user responded with ${response.status} ${response.statusText}: ${errorBody}`,
    );
  }

  const payload = (await response.json()) as {
    user?: { email?: string };
  };

  expect(payload.user).toBeTruthy();
  expect(payload.user?.email).toBe(process.env.TEST_USER);
}, 20_000);
