// vitest.config.ts

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // environment: "jsdom",
    setupFiles: "./tests/setup.ts",
  },
  // configure the alias for the @ symbol to point to the src directory
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});