// Rename from the timeline and the library: the same commands agents call
// (rename_clip, rename_media), as one undo step each.

import { runCommand } from "../lib/commands";
import type { Id } from "../lib/project/types";
import { edit } from "./actions";
import { toast } from "./toast";

function attempt(label: string, command: string, args: Record<string, unknown>) {
  try {
    edit(label, (p) => runCommand(p, command, args));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

/** Name a clip; an empty name gives it its media's name back. */
export const renameClip = (id: Id, name: string) => attempt("Rename clip", "rename_clip", { clip_ids: [id], name });

/** Rename a media file in the project; the file on disk keeps its name. */
export const renameMedia = (id: Id, name: string) => attempt("Rename media", "rename_media", { asset_id: id, name });
