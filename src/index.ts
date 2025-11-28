import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { authMiddleware, type AppEnv } from "./auth.ts";
import { env } from "./env.ts";
import { memoryRoute } from "./memory/index.ts";
import { messageRoute } from "./message.ts";
import { storyRoute } from "./story.ts";

const app = new Hono<AppEnv>();

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

// Auth middileware
app.use("/api/*", authMiddleware);

// Story routes
app.route("/api", storyRoute);
app.route("/api", memoryRoute);
app.route("/api", messageRoute);

app.get("/api/user", (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "No user in context" }, 500);
  }
  return c.json({ user });
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
