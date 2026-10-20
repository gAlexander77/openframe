import { expect, it } from "vitest";
import { runCommand } from "./commands";
import { createProject } from "./project/defaults";
import type { Project, VideoClip } from "./project/types";
import { reshape } from "./versions";

const clips = (p: Project) => p.tracks.flatMap((t) => t.clips);

it("scales a glow's, a denoise's, a sketch's and an RGB split's pixels with the picture (ADR-117)", () => {
  // A picture-in-picture on a 16:9 master with each effect: their reach was
  // fixed in the shader (glow 18 px, denoise 4.5, sketch 1) and the split
  // a number of render pixels, so a 9:16 version drew them 1.78 times as
  // large against the picture as the master did.
  let p: Project = { ...createProject(), assets: [{ id: "shot", kind: "video", name: "shot.mp4", src: "shot.mp4", duration: 20, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] };
  p = runCommand(p, "add_media_clip", { asset_id: "shot", start: 0, duration: 4 });
  const pip = clips(p)[0].id;
  p = runCommand(p, "set_param", { clip_ids: [pip], path: "transform.scale", value: 0.4 });
  for (const type of ["glow", "denoise", "sketch", "rgbSplit"]) p = runCommand(p, "add_effect", { clip_id: pip, type });
  const params = (q: Project) => (clips(q).find((c) => c.id === pip) as VideoClip).effects.map((e) => e.params);
  expect(params(p)).toEqual([
    { amount: 50, threshold: 85, radius: 18 },
    { amount: 50, radius: 4.5 },
    { amount: 50, mix: 100, width: 1 },
    { amount: 30, angle: 0 },
  ]);
  const k = 1080 / 1920;
  const [glow, denoise, sketch, split] = params(reshape(p, "9:16", "fill"));
  expect([glow.radius, denoise.radius, sketch.width, split.amount].map((v, i) => v / [18, 4.5, 1, 30][i])).toEqual([k, k, k, k].map((x) => expect.closeTo(x, 4)));
  // What is not a size stays.
  expect([glow.amount, glow.threshold, denoise.amount, sketch.amount, sketch.mix, split.angle]).toEqual([50, 85, 50, 50, 100, 0]);
  // A square version draws the picture at its pixels: nothing changes.
  expect(params(reshape(p, "1:1", "fill"))).toEqual(params(p));
});
