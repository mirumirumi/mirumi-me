import { defineConfig } from "vitest/config"

export default defineConfig({
  // server/package.json の test コマンドをどのディレクトリから呼んでも動くようにするためのもの
  root: new URL(".", import.meta.url).pathname,
  test: {
    globals: true,
    include: ["app/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts"],
    mockReset: true,
    passWithNoTests: true,
  },
})
