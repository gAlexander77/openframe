import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

// One config serves both targets: `tauri dev` loads this server in the
// webview, `npm run dev` serves the same app to a browser (ADR-003). The app
// decides which platform it is on at runtime, never at build time.
export default defineConfig({
  plugins: [react()],

  // The version the app shows, baked in at build time — no IPC for a string
  // that cannot change while the app runs.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
