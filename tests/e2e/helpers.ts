import { expect } from "vitest";

import dotenv from "dotenv";

dotenv.config({ path: "./tests/.env" });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be defined in tests/.env`);
  }
  return value;
}

export function getApiBaseUrl(): string {
  return requireEnv("API_BASE_URL");
}

export async function loginAndGetBearerToken(): Promise<string> {
  const loginUrl = `${requireEnv("AUTH_API_URL")}/sign-in/email`;
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: requireEnv("TEST_USER"),
      password: requireEnv("TEST_PASSWORD"),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "<unable to read body>");
    throw new Error(
      `Login request failed with status ${response.status} ${response.statusText}: ${errorBody}`,
    );
  }

  const token = response.headers.get("set-auth-token");
  expect(token, "Response must include an Authorization header").toBeTruthy();

  return token!;
}
