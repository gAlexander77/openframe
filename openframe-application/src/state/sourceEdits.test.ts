import { expect, it, vi } from "vitest";
import { createColorClip, createProject } from "../lib/project/defaults";
import type { Asset } from "../lib/project/types";
import { editFromSource } from "./media";
import { store } from "./store";

vi.mock("../platform", () => ({ platform: { kind: "web" } }));
vi.mock("../engine/media", () => ({ probe: vi.fn() }));
vi.mock("../engine/thumbs", () => ({ prepare: vi.fn() }));

it.each(["insert", "overwrite"] as const)("%s from marked source restores the entire document in one undo", (mode) => {
  const p = createProject();
  const asset: Asset = { id: "source", name: "Source", src: "source.mp4", kind: "video", duration: 10, hasVideo: true, hasAudio: false };
  p.assets = [asset];
  p.tracks[0].clips = [createColorClip("#203040", 0, 60), createColorClip("#402030", 60, 60)];
  store.load(p);
  store.set({ playhead: 30, inPoint: 30, outPoint: 60 });
  const id = editFromSource(asset, mode, { sourceIn: 2, sourceOut: 3, timelineIn: 1, timelineOut: 2 });
  const label = mode === "insert" ? "Insert source" : "Overwrite source";
  expect(store.history().undo).toEqual([label]);
  expect(store.document().tracks[0].clips.find((c) => c.id === id)).toMatchObject({ type: "video", start: 30, duration: 30, in: 2 });
  expect(store.get()).toMatchObject({ inPoint: null, outPoint: null, selection: [id], playhead: 60 });
  const edited = store.document();
  store.undo();
  expect(store.document()).toEqual(p);
  expect(store.history().undo).toEqual([]);
  store.redo();
  expect(store.document()).toEqual(edited);
});
