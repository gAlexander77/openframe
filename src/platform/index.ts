// The running platform. Desktop is the primary product (ADR-003); the web
// build is the same app with browser-only storage and a smaller feature set.

import { isDesktop } from "./env";
import type { Platform } from "./types";
import { web } from "./web";

// ponytail: the desktop implementation lands with its Rust commands; until
// then the desktop build runs on the browser platform inside the webview.
export const platform: Platform = isDesktop ? web : web;

export type { ExportTarget, ImportedFile, Platform, ProjectSummary } from "./types";
