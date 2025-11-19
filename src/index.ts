import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { env } from "./env.ts";
import z from "zod";

const app = new Hono<{ Variables: { user: z.infer<typeof userSchema> } }>();

// Request logging
app.use("*", logger());

// CORS configuration
const allowedOrigins = env.ALLOWED_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (env.isProduction && allowedOrigins.length === 0) {
  throw new Error(
    "ALLOWED_ORIGINS is empty in production; set at least one origin",
  );
}

app.use(
  "*",
  cors({
    origin: env.isDevelopment ? (origin) => origin : allowedOrigins,
    credentials: true,
  }),
);

app.get("/", (c) => {
  return c.text("Hello, World");
});

const userSchema = z.object({
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

// Auth
app.use("/api/*", async (c, next) => {
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
});

// Start server
const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
    console.log(`Environment: ${env.NODE_ENV}`);
  },
);

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  // Close server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // In production, might want to restart the process
  if (env.isProduction) {
    gracefulShutdown("UNHANDLED_REJECTION");
  }
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Always exit on uncaught exceptions
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});
