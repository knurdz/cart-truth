import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 15000
  },
  resolve: {
    alias: {
      "@carttruth/schemas": "/Users/rk_vishva/Documents/Projects/CartTruth/packages/schemas/src/index.ts",
      "@carttruth/core": "/Users/rk_vishva/Documents/Projects/CartTruth/packages/core/src/index.ts",
      "@carttruth/adapters": "/Users/rk_vishva/Documents/Projects/CartTruth/packages/adapters/src/index.ts",
      "@carttruth/notifications": "/Users/rk_vishva/Documents/Projects/CartTruth/packages/notifications/src/index.ts"
    }
  }
});
