// The platform seam (ADR-003). Everything that differs between the desktop
// app and the web build goes through this interface; nothing else in the
// app branches on platform.

import type { Source, StreamTargetChunk } from "mediabunny";
import type { Project } from "../lib/project/types";

export interface ImportedFile {
  name: string;
  /** Opaque location the engine hands back to sourceFor/blobFor: an
   * absolute path on desktop, an OPFS key on the web. */
  src: string;
  size: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  /** Small JPEG data URL of a frame, when one was saved. */
  thumbnail?: string;
}

export interface ExportTarget {
  /** Positional chunks from mediabunny's StreamTarget. */
  writable: WritableStream<StreamTargetChunk>;
  /** Where the file landed, for the "show in folder" prompt. */
  displayName: string;
  /** Reveal the finished file (desktop) or download it (web fallback). */
  reveal(): Promise<void>;
  /** The button text for reveal() ("Show in folder", "Download"); absent
   * when the file is already where the user chose and there is nothing to
   * reveal. */
  revealLabel?: string;
}

export interface Platform {
  kind: "desktop" | "web";
  /** Ask the user for media files. */
  pickMedia(): Promise<ImportedFile[]>;
  /** Take files dropped onto the window (web) into the app's keeping. */
  adoptFiles(files: File[]): Promise<ImportedFile[]>;
  /** Files dropped from the OS as real paths (desktop, where HTML5 file
   * drops are off). Returns the unsubscribe. */
  onFileDrop?(cb: (files: ImportedFile[]) => void): () => void;
  sourceFor(src: string): Promise<Source>;
  blobFor(src: string): Promise<Blob>;
  /** An edit-friendly copy of media the webview cannot decode (desktop,
   * FFmpeg); resolves to its src. Progress is 0..1. */
  makeProxy?(src: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<string>;

  /** Let external AI agents connect over MCP (desktop: a local server plus a
   * stdio bridge, ADR-009). Returns how to connect, or null when off. */
  agents?: {
    enable(on: boolean): Promise<AgentEndpoint | null>;
  };

  /** Desktop only: the job when the app was started with --render (ADR-029). */
  headless?: {
    job(): Promise<RenderJob | null>;
    /** The job's output file, opened for positional writes. */
    output(): Promise<WritableStream<StreamTargetChunk>>;
    report(line: string): Promise<void>;
    finish(ok: boolean, line: string): Promise<void>;
  };

  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<unknown>;
  saveProject(project: Project, summary: ProjectSummary): Promise<void>;
  deleteProject(id: string): Promise<void>;

  /** Where exports go, in a few words, for the export dialog. */
  exportLocation?: string;
  /** Ask where to save an export; null when the user cancels. */
  createExportTarget(suggestedName: string, extension: string): Promise<ExportTarget | null>;
}

export interface AgentEndpoint {
  /** Streamable HTTP endpoint. */
  url: string;
  /** Bearer token every request must carry. */
  token: string;
  /** Command line for clients that launch MCP servers as processes. */
  stdio: string;
}

export interface RenderJob {
  /** Project JSON with media paths already absolute. */
  project: string;
  out: string;
  format: string | null;
  resolution: string | null;
  quality: string | null;
}
