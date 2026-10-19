// @ts-check
// The site deploys to GitHub Pages as a project site:
// https://galexander77.github.io/openframe/ (docs/decisions/ADR-077).
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://galexander77.github.io",
  base: "/openframe",
  trailingSlash: "always",
  output: "static",
  // Keep the space between a word and an inline element that starts on the
  // next source line ("the" + newline + <a>roadmap</a>): compression joined them.
  compressHTML: false,
  build: { format: "directory" },
  integrations: [react(), sitemap()],
  devToolbar: { enabled: false },
  server: { port: 1447, host: "127.0.0.1" },
});
