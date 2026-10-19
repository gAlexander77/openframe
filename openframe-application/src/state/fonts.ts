// Fonts beyond the built-in list (CapCut's font upload, Premiere's system
// fonts): fonts imported from files, kept per viewer in the origin-private
// file system and registered at startup so preview and export both draw
// them; and the computer's installed families through Local Font Access.
// A project names fonts by family; on a computer without one, text falls
// back to the system font, as in CapCut.

import { useSyncExternalStore } from "react";
import { toast } from "./toast";

const DIR = "fonts";
const FONT_FILE = /\.(ttf|otf|woff2?)$/i;
let imported: string[] = [];
let system: string[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
let snapshot = { imported, system };
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useFonts = () => useSyncExternalStore(subscribe, () => snapshot);
const publish = () => {
  snapshot = { imported, system };
  changed();
};

/** The family a font file is drawn under: its name without the extension. */
export const familyOf = (fileName: string) => fileName.replace(FONT_FILE, "").replace(/[_]+/g, " ").trim();

async function fontsDir() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
}

async function register(family: string, data: ArrayBuffer) {
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  if (!imported.includes(family)) imported = [...imported, family].sort((a, b) => a.localeCompare(b));
}

/** Register every imported font; the headless renderer waits for this. */
export async function loadSavedFonts() {
  try {
    const dir = await fontsDir();
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== "file" || !FONT_FILE.test(name)) continue;
      try {
        await register(familyOf(name), await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
      } catch {
        /* a damaged file: skip it, keep the rest */
      }
    }
  } catch {
    /* no private storage here: imported fonts last this session */
  }
  publish();
}

/** Import font files, keeping them for next time. Returns the families. */
export async function importFonts(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    if (!FONT_FILE.test(file.name)) {
      toast(`${file.name} is not a font file (TTF, OTF or WOFF).`, "error");
      continue;
    }
    const data = await file.arrayBuffer();
    try {
      await register(familyOf(file.name), data);
    } catch {
      toast(`${file.name} could not be read as a font.`, "error");
      continue;
    }
    out.push(familyOf(file.name));
    try {
      const w = await (await (await fontsDir()).getFileHandle(file.name, { create: true })).createWritable();
      await w.write(data);
      await w.close();
    } catch {
      /* kept for this session only */
    }
  }
  publish();
  return out;
}

export const canListSystemFonts = () => typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === "function";

/** The families installed on this computer (asks for permission once).
 * Call from a click: the browser requires a user gesture. */
export async function loadSystemFonts() {
  try {
    const fonts = await (window as unknown as { queryLocalFonts(): Promise<{ family: string }[]> }).queryLocalFonts();
    system = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    publish();
    if (!system.length) toast("No installed fonts were shared with the editor.");
  } catch (e) {
    toast(`Installed fonts are not available: ${(e as Error).message || e}`, "error");
  }
}

/** A file picker for fonts, from a click. */
export function pickFontFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".ttf,.otf,.woff,.woff2";
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}
