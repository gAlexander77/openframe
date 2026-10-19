import { expect, it } from "vitest";
import { clipForAsset, createProject, normalizeProject } from "./project/defaults";
import { runCommand } from "./commands";
import { planFrame, planLayers } from "./render/plan";
import { addClip, splitClip, trimClip } from "./project/ops";
import type { Asset } from "./project/types";
const asset: Asset = { id: "animation", kind: "image", src: "animation.gif", name: "animation.gif", animated: true, duration: 1, hasAudio: false, hasVideo: true };
it("keeps animation phase when split or trimmed and allows more loops", () => {
  let p = createProject(); p.assets = [asset];
  const c = clipForAsset(asset, 0, p.fps);
  expect(c.duration).toBe(30);
  p = addClip(p, p.tracks[0].id, c);
  const long = trimClip(p, c.id, "end", 90);
  expect(long.tracks[0].clips[0].duration).toBe(90);
  const split = splitClip(long, c.id, 13);
  const source = planLayers(planFrame(split, 20))[0].source;
  expect(source.kind).toBe("image");
  if (source.kind === "image") expect(source.time).toBeCloseTo(20 / 30);
});
it("normalizes and round trips master, pan, solo and color", () => {
  let p = createProject();
  p = runCommand(p, "set_project", { master_volume: 0.5 });
  p = runCommand(p, "update_track", { track_id: p.tracks[0].id, pan: -0.4, solo: true, color: "purple" });
  const restored = normalizeProject(JSON.parse(JSON.stringify(p)));
  expect(restored.masterVolume).toBe(0.5);
  expect(restored.tracks[0]).toMatchObject({ pan: -0.4, solo: true, color: "purple" });
  expect(runCommand(restored, "update_track", { track_id: p.tracks[0].id, color: "none" }).tracks[0].color).toBeUndefined();
});
