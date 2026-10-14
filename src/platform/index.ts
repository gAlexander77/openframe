// The running platform. Desktop is the primary product (ADR-003); the web
// build is the same app with browser-only storage and a smaller feature set.

import { desktop } from "./desktop";
import { isDesktop } from "./env";
import type { Platform } from "./types";
import { web } from "./web";

export const platform: Platform = isDesktop ? desktop : web;

export type { AgentEndpoint, ExportTarget, ImportedFile, Platform, ProjectSummary } from "./types";
