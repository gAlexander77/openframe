import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import pkg from "./package.json" with { type: "json" };
import { readCredits } from "./src/lib/about.ts";

const host = process.env.TAURI_DEV_HOST;

// Help > About's credits, read from what is installed and locked when the
// app is built (src/lib/about.ts).
const text = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const credits = readCredits(
  pkg,
  (name) => {
    try {
      return JSON.parse(text(`./node_modules/${name}/package.json`));
    } catch {
      return null;
    }
  },
  text("./src-tauri/Cargo.toml"),
  text("./src-tauri/Cargo.lock"),
);

// One config serves both targets: `tauri dev` loads this server in the
// webview, `npm run dev` serves the same app to a browser (ADR-003). The app
// decides which platform it is on at runtime, never at build time.
export default defineConfig({
  plugins: [react()],

  // The version the app shows, baked in at build time — no IPC for a string
  // that cannot change while the app runs.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_CREDITS__: JSON.stringify(credits),
  },

  // Workers are ES modules so they can import mediabunny like the main thread.
  worker: { format: "es" },

  // Pre-bundle the heavy media/AI dependencies at startup. Otherwise Vite
  // discovers them on first use (opening the captions worker, say) and
  // reloads the page to re-optimize, losing whatever the user was doing —
  // TermHQ hit the same trap with Monaco.
  optimizeDeps: {
    include: ["mediabunny", "@huggingface/transformers", "lucide-react"],
  },

  // Tauri expects a fixed port and must see Rust errors, so no screen clear.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
