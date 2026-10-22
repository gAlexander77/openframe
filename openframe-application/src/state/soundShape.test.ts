import { expect, it } from "vitest";
import { runAgentCommand } from "../lib/commands";
import { clipForAsset, createProject, createTrack } from "../lib/project/defaults";
import type { AudioClip } from "../lib/project/types";
import { store } from "./store";

it("each sound-shaping command changes every selected clip in one undo step", () => {
  const p = createProject();
  const asset = { id: "a", name: "Voice", src: "voice.wav", kind: "audio" as const, duration: 20, hasAudio: true, hasVideo: false };
  p.assets = [asset];
  const a = { ...clipForAsset(asset, 0, p.fps), duration: 90 } as AudioClip;
  const b = { ...a, id: "b", start: 90, in: 5 };
  p.tracks.push({ ...createTrack("audio", "Voice"), clips: [a, b] });
  const clip_ids = [a.id, b.id];
  for (const [name, args] of [
    ["set_fades", { clip_ids, fade_in: 0.5, curve: "sCurve" }],
    ["set_crossfade", { clip_id: a.id, seconds: 0.5, curve: "logarithmic" }],
    ["set_pitch", { clip_ids, semitones: 5 }],
    ["apply_voice_preset", { clip_ids, preset: "robot" }],
  ] as const) {
    store.load(p);
    store.editDocument(name, (doc) => runAgentCommand(doc, name, args));
    expect(store.history().undo).toEqual([name]);
    expect(store.document()).not.toEqual(p);
    store.undo();
    expect(store.document()).toEqual(p);
    expect(store.history().undo).toEqual([]);
  }
});
