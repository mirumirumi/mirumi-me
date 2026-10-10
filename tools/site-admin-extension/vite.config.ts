import { crx } from "@crxjs/vite-plugin"
import { defineConfig } from "vite"

import manifest from "./manifest.json" with { type: "json" }

export default defineConfig({
  plugins: [crx({ manifest })],
})
