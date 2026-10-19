// Adding a library sticker: render its PNG once, hand the file to the
// platform like any import, and place it as an image clip on top — the asset
// and the clip in one undo step. A project that already has the sticker
// reuses its asset; the rendered file is reused for the whole session
// (ADR-025).

import { renderSticker } from "../engine/stickers";
import { prepare } from "../engine/thumbs";
import { uid } from "../lib/project/defaults";
import type { Asset, Id } from "../lib/project/types";
import { runCommand } from "../lib/commands";
import {
  addStickerClip,
  DEFAULT_STICKER_MOTION,
  findSticker,
  STICKER_INDEX,
  STICKER_MOTIONS,
  stickerAsset,
  stickerFileName,
  withAsset,
  type StickerDef,
} from "../lib/stickers";
import { platform, type ImportedFile } from "../platform";
import { revealAdded } from "./apply";
import { store } from "./store";
import { toast } from "./toast";
import { projectWork } from "./projectWork";

const files = new Map<string, Promise<{ file: ImportedFile; width: number; height: number }>>();

/** The sticker's file, rendered and adopted at most once per session. */
function stickerFile(s: StickerDef) {
  let hit = files.get(s.id);
  if (!hit) {
    hit = renderSticker(s).then(async ({ blob, width, height }) => {
      const [file] = await platform.adoptFiles([new File([blob], stickerFileName(s), { type: "image/png" })]);
      return { file, width, height };
    });
    files.set(s.id, hit);
    hit.catch(() => files.delete(s.id));
  }
  return hit;
}

/** The project's asset for a sticker, or a new one (not yet in the
 * project) whose file is ready. */
export async function stickerAssetFor(s: StickerDef): Promise<Asset> {
  const have = store.get().project.assets.find((a) => a.sticker === s.id);
  if (have) return have;
  const { file, width, height } = await stickerFile(s);
  // Another add may have landed while this one rendered.
  return store.get().project.assets.find((a) => a.sticker === s.id) ?? stickerAsset(s, file, width, height, uid("a"));
}

const MOTION_KEY = "ve.stickerMotion";

/** The motion new stickers get; a per-viewer preference. */
export function stickerMotion(): string {
  try {
    const m = localStorage.getItem(MOTION_KEY);
    if (m && STICKER_MOTIONS[m]) return m;
  } catch {
    /* storage blocked: use the default */
  }
  return DEFAULT_STICKER_MOTION;
}

export function setStickerMotion(m: string) {
  try {
    localStorage.setItem(MOTION_KEY, m);
  } catch {
    /* storage blocked: the choice lasts this session only */
  }
}

/** The add_sticker command for automation: draw the sticker's file when the
 * project lacks it, then run the command with the asset added — one undo
 * step, like a click. Throws the command's validation errors. */
export async function execAddSticker(args: unknown, report?: import("../lib/commands").CommandReport) {
  const signal = projectWork.signal();
  const name = typeof args === "object" && args !== null ? (args as { name?: unknown }).name : undefined;
  const s = typeof name === "string" ? findSticker(name) : undefined;
  const asset = s ? await stickerAssetFor(s) : null;
  signal.throwIfAborted();
  store.edit("Add sticker", (p) => runCommand(asset ? withAsset(p, asset) : p, "add_sticker", args, report));
  if (asset) prepare(asset);
}

/** Add a sticker at `at` (default: the playhead) above everything there. */
export async function addSticker(id: string, at?: number): Promise<Id | null> {
  const signal = projectWork.signal();
  const s = STICKER_INDEX.get(id);
  if (!s) return null;
  const start = at ?? store.get().playhead;
  let asset: Asset;
  try {
    asset = await stickerAssetFor(s);
    if (signal.aborted) return null;
  } catch (e) {
    toast(`Couldn't make the ${s.label.toLowerCase()} sticker: ${e instanceof Error ? e.message : e}`, "error");
    return null;
  }
  let clipId = "";
  store.edit(`Add ${s.label.toLowerCase()} sticker`, (p) => {
    const r = addStickerClip(p, asset, { start, motion: stickerMotion() });
    clipId = r.clipId;
    return r.project;
  });
  prepare(asset);
  store.select([clipId]);
  revealAdded([clipId]);
  return clipId;
}
