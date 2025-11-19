import type { MiddlewareHandler } from "hono";
import z from "zod";

import { env } from "./env.ts";

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  role: z.enum(["user", "admin"]),
});

const sessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  expiresAt: z.iso.datetime(),
});

const sessionResponseSchema = z.object({
  user: userSchema,
  session: sessionSchema,
});

export type User = z.infer<typeof userSchema>;

export const authMiddleware: MiddlewareHandler<{ Variables: { user: User } }> =
  async (c, next) => {
    const authHeader =
      c.req.header("Authorization") || c.req.header("authorization");
    const unauthorized = (message: string) => c.json({ error: message }, 401);

    if (!authHeader) {
      return unauthorized("Missing Authorization header");
    }
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return unauthorized("Authorization header must use the Bearer scheme");
    }

    const token = tokenMatch[1]?.trim();
    if (!token) {
      return unauthorized("Bearer token is empty");
    }

    const authBase = env.AUTH_API_URL.endsWith("/")
      ? env.AUTH_API_URL
      : `${env.AUTH_API_URL}/`;
    const sessionUrl = new URL("get-session", authBase).toString();

    let sessionResponse: Response;
    try {
      sessionResponse = await fetch(sessionUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch (error) {
      console.error("Failed to contact auth service", error);
      return c.json({ error: "Unable to reach auth service" }, 502);
    }

    if (sessionResponse.status === 401 || sessionResponse.status === 403) {
      return unauthorized("Invalid or expired session");
    }

    if (!sessionResponse.ok) {
      const body = await sessionResponse.text().catch(() => "<no-body>");
      console.error(
        `Auth service responded with ${sessionResponse.status}: ${body}`,
      );
      return c.json({ error: "Auth service error" }, 502);
    }

    let sessionPayload: unknown;
    try {
      sessionPayload = await sessionResponse.json();
    } catch (error) {
      console.error("Auth service returned invalid JSON", error);
      return c.json({ error: "Invalid auth service response" }, 502);
    }

    const parsedSession = sessionResponseSchema.safeParse(sessionPayload);
    if (!parsedSession.success) {
      console.error(
        "Auth service response failed validation",
        parsedSession.error,
      );
      return c.json({ error: "Invalid auth service response" }, 502);
    }

    c.set("user", parsedSession.data.user);
    await next();
  };
