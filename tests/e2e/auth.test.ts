import { expect, test } from "vitest";

import dotenv from "dotenv";
dotenv.config({ path: "./tests/.env" });

async function loginAndGetBearerToken() {
  const loginUrl = `${process.env.AUTH_API_URL}/sign-in/email`;
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: process.env.TEST_USER,
      password: process.env.TEST_PASSWORD,
    }),
  });

  if (!response.ok) {
    const errorBody = await response
      .text()
      .catch(() => "<unable to read body>");
    throw new Error(
      `Login request failed with status ${response.status} ${response.statusText}: ${errorBody}`,
    );
  }

  const token = response.headers.get("set-auth-token");
  expect(token, "Response must include an Authorization header").toBeTruthy();

  return token;
}

test("authenticated user can fetch their profile via /api/user", async () => {
  const token = await loginAndGetBearerToken();
  const response = await fetch(`${process.env.API_BASE_URL}/api/user`, {
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
