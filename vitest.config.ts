/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // common defaults for all projects
    globals: true,
    environment: "node",
    projects: [
      // UNIT
      defineConfig({
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      }),

      // E2E
      defineConfig({
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
        },
      }),
    ],
  },
});
