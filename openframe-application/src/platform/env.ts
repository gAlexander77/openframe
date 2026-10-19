// Which shell the app is running in. The only runtime platform check; every
// other difference goes through the platform module (ADR-003).
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
