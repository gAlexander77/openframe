/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/** Help > About's credits (src/lib/about.ts), baked in at build time. */
declare const __APP_CREDITS__: import("./lib/about").Credit[];
