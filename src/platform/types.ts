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

  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<unknown>;
  saveProject(project: Project, summary: ProjectSummary): Promise<void>;
  deleteProject(id: string): Promise<void>;

  /** Ask where to save an export; null when the user cancels. */
  createExportTarget(suggestedName: string, extension: string): Promise<ExportTarget | null>;
}
