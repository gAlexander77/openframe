// The graphics commands (ADR-056 to ADR-059, ADR-062) and their project format.
import { describe, expect, it } from "vitest";
import { ANIMATABLE_PATHS, keyframeProblem } from "./animatable";
import { describeProject, runCommand } from "./commands";
import { checkProject } from "./designCheck";
import { createProject, normalizeProject } from "./project/defaults";
import type { Clip, ColorClip, Project } from "./project/types";

const clips = (p: Project) => p.tracks.flatMap((t) => t.clips);
const byStart = (p: Project, seconds: number) => clips(p).find((c) => c.start === seconds * 30)!;
const described = (p: Project, id: string) => describeProject(p).tracks.flatMap((t) => t.clips).find((c) => c.id === id) as Record<string, unknown>;
const fresh = () => createProject({ fps: { num: 30, den: 1 } });

describe("add_shape", () => {
  it("adds a rectangle where asked, above what is there", () => {
    let p = runCommand(fresh(), "add_text", { text: "Hi", start: 0, duration: 2 });
    p = runCommand(p, "add_shape", { kind: "rectangle", start: 0, duration: 2, x: -0.2, y: 0.3, width: 0.4, height: 0.1, color: "#112233" });
    const s = clips(p).find((c) => c.type === "color") as ColorClip;
    expect(s.shape).toEqual({ kind: "rectangle", width: 0.4, height: 0.1 });
    expect([s.color, s.transform.x, s.transform.y, s.name]).toEqual(["#112233", -0.2, 0.3, "Rectangle"]);
    // Placed above the title, which was there first.
    const order = p.tracks.map((t) => t.clips[0]?.type).filter(Boolean);
    expect(order.indexOf("color")).toBeLessThan(order.indexOf("text"));
    expect(described(p, s.id).shape).toEqual({ kind: "rectangle", width: 0.4, height: 0.1 });
    expect(described(p, s.id).color).toBe("#112233");
  });

  it("gives each kind its useful defaults", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rounded_rectangle", start: 0, duration: 1 });
    p = runCommand(p, "add_shape", { kind: "ellipse", start: 1, duration: 1 });
    p = runCommand(p, "add_shape", { kind: "line", start: 2, duration: 1, color: "#ff0000" });
    const [pill, ellipse, line] = [0, 1, 2].map((s) => (byStart(p, s) as ColorClip).shape!);
    expect(pill).toEqual({ kind: "rectangle", width: 0.3, height: 0.1, radius: 0.35 });
    // A circle: as tall in pixels as it is wide.
    expect(ellipse.width * 1920).toBeCloseTo(ellipse.height * 1080, 6);
    expect(line.stroke).toEqual({ color: "#ff0000", width: 8 });
    expect(described(p, byStart(p, 0).id).shape).toMatchObject({ kind: "rounded_rectangle", radius: 0.35 });
  });

  it("takes gradients, outlines and a draw amount", () => {
    const p = runCommand(fresh(), "add_shape", { kind: "ellipse", start: 0, duration: 1, fill: false, stroke_color: "rgba(255,255,255,0.8)", stroke_width: 6, draw: 0.4, gradient: { from: "#000", to: "#fff", angle: 90 } });
    expect((clips(p)[0] as ColorClip).shape).toMatchObject({ fill: false, stroke: { color: "rgba(255,255,255,0.8)", width: 6 }, draw: 0.4, gradient: { from: "#000", to: "#fff", angle: 90 } });
  });

  it("refuses colors the compositor cannot read and hollow shapes with no outline", () => {
    expect(() => runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 1, color: "blurple" })).toThrow(/not a color/);
    expect(() => runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 1, fill: false })).toThrow(/stroke_width/);
  });
});

describe("set_shape", () => {
  it("changes what is given and keys what is animated", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "line", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_shape", { clip_ids: [id], width: 0.6, color: "#00ff00" });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "shape.draw", at: 0, value: 0 });
    p = runCommand(p, "set_shape", { clip_ids: [id], draw: 1, at: 1 });
    const c = clips(p)[0] as ColorClip;
    expect([c.shape!.width, c.color]).toEqual([0.6, "#00ff00"]);
    expect(c.keyframes!["shape.draw"].map((k) => [k.f, k.v])).toEqual([[0, 0], [30, 1]]);
    expect(() => runCommand(p, "set_shape", { clip_ids: [id], gradient: { from: "" } })).not.toThrow();
    // A name still the shape's own label follows a change of kind.
    expect(clips(runCommand(p, "set_shape", { clip_ids: [id], kind: "ellipse" }))[0].name).toBe("Ellipse");
  });

  it("refuses clips that are not shapes", () => {
    const p = runCommand(fresh(), "add_color_clip", { color: "#000", start: 0, duration: 1 });
    expect(() => runCommand(p, "set_shape", { clip_ids: [clips(p)[0].id], width: 0.2 })).toThrow(/not a shape/);
  });
});

describe("set_track_matte", () => {
  const scene = () => {
    let p = runCommand(fresh(), "add_color_clip", { color: "#336699", start: 0, duration: 3 });
    p = runCommand(p, "add_text", { text: "BIG", start: 0, duration: 3 });
    return { p, base: clips(p).find((c) => c.type === "color")!.id, text: clips(p).find((c) => c.type === "text")!.id };
  };

  it("names a matte, keeps it when only the mode changes, and removes it", () => {
    let { p, base, text } = scene();
    p = runCommand(p, "set_track_matte", { clip_id: base, matte_clip_id: text });
    expect(described(p, base).track_matte).toEqual({ mode: "alpha", matte: text });
    p = runCommand(p, "set_track_matte", { clip_id: base, mode: "lumaInverted" });
    expect(described(p, base).track_matte).toEqual({ mode: "lumaInverted", matte: text });
    p = runCommand(p, "set_track_matte", { clip_id: base, matte_clip_id: "none" });
    expect(described(p, base).track_matte).toBeUndefined();
  });

  it("uses the track above, which must exist", () => {
    let { p, base, text } = scene();
    // The title sits on a track above the solid's.
    p = runCommand(p, "set_track_matte", { clip_id: base, matte_clip_id: "above" });
    expect(described(p, base).track_matte).toEqual({ mode: "alpha", matte: "above" });
    expect(() => runCommand(p, "set_track_matte", { clip_id: text })).toThrow(/no video track directly above/);
  });

  it("refuses itself and clips with no picture", () => {
    const { p, base } = scene();
    expect(() => runCommand(p, "set_track_matte", { clip_id: base, matte_clip_id: base })).toThrow(/own matte/);
    const q = runCommand(p, "add_adjustment_clip", { start: 0, duration: 1 });
    const adj = clips(q).find((c) => c.type === "adjustment")!.id;
    expect(() => runCommand(q, "set_track_matte", { clip_id: base, matte_clip_id: adj })).toThrow(/no picture/);
  });
});

describe("set_motion_blur and set_edge_mode", () => {
  it("turn on, change and off", () => {
    let p = runCommand(fresh(), "add_color_clip", { color: "#fff", start: 0, duration: 1 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_motion_blur", { clip_ids: [id], on: true });
    expect(described(p, id).motion_blur).toEqual({ shutter_angle: 180 });
    p = runCommand(p, "set_motion_blur", { clip_ids: [id], on: true, shutter_angle: 270 });
    expect((clips(p)[0] as ColorClip).motionBlur).toEqual({ shutter: 270 });
    p = runCommand(p, "set_motion_blur", { clip_ids: [id], on: false });
    expect("motionBlur" in clips(p)[0]).toBe(false);
    p = runCommand(p, "set_edge_mode", { clip_ids: [id], edge: "mirror" });
    expect(described(p, id).edge).toBe("mirror");
    p = runCommand(p, "set_edge_mode", { clip_ids: [id], edge: "none" });
    expect("edge" in clips(p)[0]).toBe(false);
  });
});

describe("set_wiggle", () => {
  it("stores pixels, degrees and percent in the value's own units", () => {
    let p = runCommand(fresh(), "add_color_clip", { color: "#fff", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_wiggle", { clip_ids: [id], target: "position", frequency: 4, amplitude: 19.2 });
    p = runCommand(p, "set_wiggle", { clip_ids: [id], target: "rotation", amplitude: 2 });
    p = runCommand(p, "set_wiggle", { clip_ids: [id], target: "scale", amplitude: 5, seed: 9 });
    const w = (clips(p)[0] as ColorClip).wiggle!;
    expect(w.x!.amplitude).toBeCloseTo(0.01, 9);
    expect(w.y!.amplitude).toBeCloseTo(19.2 / 1080, 9);
    expect([w.x!.frequency, w.rotation!.frequency, w.rotation!.amplitude, w.scale!.amplitude, w.scale!.seed]).toEqual([4, 3, 2, 0.05, 9]);
    expect(w.x!.seed).toBe(w.y!.seed);
  });

  it("keys strength at `at`, and amplitude 0 removes it with its keys", () => {
    let p = runCommand(fresh(), "add_color_clip", { color: "#fff", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_wiggle", { clip_ids: [id], target: "x", amplitude: 10, strength: 0, at: 0 });
    p = runCommand(p, "set_wiggle", { clip_ids: [id], target: "x", strength: 1, at: 1 });
    const c = clips(p)[0] as ColorClip;
    expect(c.keyframes!["wiggle.x.strength"].map((k) => [k.f, k.v])).toEqual([[0, 0], [30, 1]]);
    expect(c.wiggle!.x!.strength).toBeUndefined();
    p = runCommand(p, "set_wiggle", { clip_ids: [id], target: "x", amplitude: 0 });
    const gone = clips(p)[0] as ColorClip;
    expect([gone.wiggle, gone.keyframes]).toEqual([undefined, undefined]);
  });

  it("needs an amplitude to start", () => {
    const p = runCommand(fresh(), "add_color_clip", { color: "#fff", start: 0, duration: 2 });
    expect(() => runCommand(p, "set_wiggle", { clip_ids: [clips(p)[0].id], target: "y", frequency: 2 })).toThrow(/give an amplitude/);
  });
});

describe("add_keyframe eases", () => {
  it("takes spring, elastic and bounce", () => {
    let p = runCommand(fresh(), "add_color_clip", { color: "#fff", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.y", at: 0, value: 0.5, ease: "bounce" });
    expect(clips(p)[0].keyframes!["transform.y"][0].ease).toBe("bounce");
    p = runCommand(p, "set_keyframe_ease", { clip_id: id, ease: "spring" });
    expect(clips(p)[0].keyframes!["transform.y"][0].ease).toBe("spring");
  });
});

describe("project format", () => {
  it("keeps the new fields through the loader, and drops broken ones", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 2, stroke_width: 4 });
    p = runCommand(p, "add_text", { text: "A", start: 0, duration: 2 });
    const [shape, text] = [clips(p).find((c) => c.type === "color")!, clips(p).find((c) => c.type === "text")!];
    p = runCommand(p, "set_track_matte", { clip_id: shape.id, matte_clip_id: text.id, mode: "luma" });
    p = runCommand(p, "set_motion_blur", { clip_ids: [shape.id], on: true });
    p = runCommand(p, "set_edge_mode", { clip_ids: [shape.id], edge: "repeat" });
    p = runCommand(p, "set_wiggle", { clip_ids: [shape.id], target: "rotation", amplitude: 1 });
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    const s = clips(back).find((c) => c.id === shape.id) as ColorClip;
    expect([s.shape?.kind, s.trackMatte, s.motionBlur, s.edge, !!s.wiggle?.rotation]).toEqual(["rectangle", { clipId: text.id, mode: "luma" }, { shutter: 180 }, "repeat", true]);

    // A matte whose clip is gone, an unknown edge, a shape with no kind.
    const raw = JSON.parse(JSON.stringify(p));
    const rs = raw.tracks.flatMap((t: { clips: Clip[] }) => t.clips).find((c: Clip) => c.id === shape.id);
    Object.assign(rs, { edge: "wrap", shape: { width: 1 }, motionBlur: { shutter: 0 } });
    raw.tracks = raw.tracks.map((t: { clips: Clip[] }) => ({ ...t, clips: t.clips.filter((c) => c.id !== text.id) }));
    const broken = clips(normalizeProject(raw)).find((c) => c.id === shape.id) as ColorClip;
    expect(["trackMatte", "edge", "shape", "motionBlur"].filter((k) => k in broken)).toEqual([]);
  });
});

describe("soft light, shadows and animated type (ADR-069 to ADR-071)", () => {
  it("add_shape takes a feather and a radial gradient; set_shape changes them", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "ellipse", start: 0, duration: 2, width: 0.5, height: 0.6, feather: 120, gradient: { kind: "radial", from: "#6a5cffcc", to: "transparent", radius: 0.9 } });
    const id = clips(p)[0].id;
    expect((clips(p)[0] as ColorClip).shape).toEqual({ kind: "ellipse", width: 0.5, height: 0.6, feather: 120, gradient: { from: "#6a5cffcc", to: "transparent", angle: 0, kind: "radial", radius: 0.9 } });
    expect(described(p, id).shape).toMatchObject({ feather: 120, gradient: { kind: "radial" } });
    p = runCommand(p, "set_shape", { clip_ids: [id], feather: 0, gradient: { from: "#fff", kind: "linear" } });
    expect((clips(p)[0] as ColorClip).shape).toEqual({ kind: "ellipse", width: 0.5, height: 0.6, gradient: { from: "#fff", to: "transparent", angle: 0 } });
    // Keyed, a feather keys at `at`.
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "shape.feather", at: 0, value: 0 });
    p = runCommand(p, "set_shape", { clip_ids: [id], feather: 300, at: 1 });
    expect(clips(p)[0].keyframes!["shape.feather"].map((k) => [k.f, k.v])).toEqual([[0, 0], [30, 300]]);
    expect(() => runCommand(p, "add_shape", { kind: "ellipse", start: 0, duration: 1, gradient: { kind: "spiral", from: "#fff", to: "#000" } })).toThrow(/kind/);
  });

  it("set_shadow gives a picture a shadow, changes and keys it, and takes it off", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_shadow", { clip_ids: [id] });
    expect((clips(p)[0] as ColorClip).shadow).toEqual({ color: "#000000", blur: 60, x: 0, y: 24, opacity: 0.5 });
    p = runCommand(p, "set_shadow", { clip_ids: [id], color: "#102030", blur: 90, opacity: 0.7 });
    expect((clips(p)[0] as ColorClip).shadow).toEqual({ color: "#102030", blur: 90, x: 0, y: 24, opacity: 0.7 });
    expect(described(p, id).shadow).toEqual({ color: "#102030", blur: 90, x: 0, y: 24, opacity: 0.7 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "shadow.y", at: 0, value: 0 });
    p = runCommand(p, "set_shadow", { clip_ids: [id], y: 40, at: 1 });
    expect(clips(p)[0].keyframes!["shadow.y"].map((k) => [k.f, k.v])).toEqual([[0, 0], [30, 40]]);
    expect((clips(p)[0] as ColorClip).shadow!.y).toBe(24);
    p = runCommand(p, "set_shadow", { clip_ids: [id], off: true });
    expect("shadow" in clips(p)[0]).toBe(false);
    expect(clips(p)[0].keyframes).toBeUndefined();
    expect(() => runCommand(p, "set_shadow", { clip_ids: [id], color: "smoke" })).toThrow(/not a color/);
    const q = runCommand(fresh(), "add_adjustment_clip", { start: 0, duration: 1 });
    expect(() => runCommand(q, "set_shadow", { clip_ids: [clips(q)[0].id] })).toThrow(/no picture/);
  });

  it("animate_text_style keys size, spacing and color on a title", () => {
    let p = runCommand(fresh(), "add_text", { text: "Wide", start: 1, duration: 3 });
    const id = clips(p)[0].id;
    p = runCommand(p, "animate_text_style", { clip_id: id, keys: [{ at: 1, letter_spacing: 0, size: 90, color: "#ffffff", ease: "easeOut" }, { at: 2.5, letter_spacing: 24, color: "#ffd23f" }] });
    const k = clips(p)[0].keyframes!;
    expect(k["style.letterSpacing"]).toEqual([{ f: 0, v: 0, ease: "easeOut" }, { f: 45, v: 24 }]);
    expect(k["style.size"]).toEqual([{ f: 0, v: 90, ease: "easeOut" }]);
    expect(k["style.color"].map((x) => x.v)).toEqual([0xffffff, 0xffd23f]);
    expect(Object.keys(described(p, id).keyframes as object)).toEqual(expect.arrayContaining(["style.size", "style.letterSpacing", "style.color"]));
    expect(() => runCommand(p, "animate_text_style", { clip_id: id, keys: [{ at: 1 }] })).toThrow(/sets nothing/);
    expect(() => runCommand(p, "animate_text_style", { clip_id: id, keys: [{ at: 1, color: "glow" }] })).toThrow(/not a color/);
    const q = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 1 });
    expect(() => runCommand(q, "animate_text_style", { clip_id: clips(q)[0].id, keys: [{ at: 0, size: 10 }] })).toThrow(/titles/);
  });

  it("the loader keeps shadows, feathers, radial fills and weights, and drops broken ones", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "ellipse", start: 0, duration: 2, feather: 80, gradient: { kind: "radial", from: "#fff", to: "#0000", x: 0.2 } });
    p = runCommand(p, "add_text", { text: "Light", start: 0, duration: 2, style: { weight: 300 } });
    const [shape, text] = [clips(p).find((c) => c.type === "color")!, clips(p).find((c) => c.type === "text")!];
    p = runCommand(p, "set_shadow", { clip_ids: [shape.id, text.id], blur: 30 });
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(clips(back)).toEqual(clips(p));
    const raw = JSON.parse(JSON.stringify(p));
    for (const c of raw.tracks.flatMap((t: { clips: Clip[] }) => t.clips)) {
      if (c.type === "text") Object.assign(c, { shadow: "soft", style: { ...c.style, weight: "light" } });
      else Object.assign(c, { shadow: { blur: 9999 } });
    }
    const loaded = clips(normalizeProject(raw));
    const t = loaded.find((c) => c.type === "text") as Clip & { style: { weight?: number } };
    expect(["shadow" in t, "weight" in t.style]).toEqual([false, false]);
    expect((loaded.find((c) => c.type === "color") as ColorClip).shadow).toEqual({ color: "#000000", blur: 600, x: 0, y: 24, opacity: 0.5 });
  });
});

describe("set_tilt (ADR-070)", () => {
  it("tilts, keys and lays a picture flat again", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_tilt", { clip_ids: [id], y: -18, x: 6, perspective: 1500 });
    expect(clips(p)[0]).toMatchObject({ transform: { rotateX: 6, rotateY: -18, perspective: 1500 } });
    expect(described(p, id).transform).toMatchObject({ rotate_x: 6, rotate_y: -18, perspective: 1500 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.rotateY", at: 0, value: -35 });
    p = runCommand(p, "set_tilt", { clip_ids: [id], y: 0, at: 1 });
    expect(clips(p)[0].keyframes!["transform.rotateY"].map((k) => [k.f, k.v])).toEqual([[0, -35], [30, 0]]);
    p = runCommand(p, "remove_keyframes", { clip_id: id, path: "transform.rotateY" });
    p = runCommand(p, "set_tilt", { clip_ids: [id], x: 0, y: 0 });
    expect(["rotateX", "rotateY", "perspective"].filter((k) => k in (clips(p)[0] as ColorClip).transform)).toEqual([]);
    expect(() => runCommand(p, "set_tilt", { clip_ids: [id], y: 120 })).toThrow(/<= 89/);
  });
});

describe("style keys take only what they animate (ADR-099)", () => {
  it("add_keyframe refuses a color on a number's path instead of keying it as the number", () => {
    let p = runCommand(fresh(), "add_text", { text: "Grow", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    // #ff0000 as a size was a 16,711,680-pixel title.
    expect(() => runCommand(p, "add_keyframe", { clip_id: id, path: "style.size", at: 1, color: "#ff0000" })).toThrow(/color is for a color path/);
    expect(() => runCommand(p, "add_keyframe", { clip_id: id, path: "transform.x", at: 1, color: "red" })).toThrow(/takes value/);
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "style.color", at: 1, color: "#ff3366" });
    expect(clips(p)[0].keyframes!["style.color"]).toEqual([{ f: 30, v: 0xff3366 }]);
    expect(() => runCommand(p, "add_keyframe", { clip_id: id, path: "style.weight", at: 1, value: 300 })).toThrow(/does not animate/);
  });

  it("set_param keeps a title's color CSS, keys it when it is keyed, and sets only numbers", () => {
    let p = runCommand(fresh(), "add_text", { text: "Hue", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_param", { clip_ids: [id], path: "style.color", value: 0x0000ff });
    expect((clips(p)[0] as Clip & { style: { color: unknown } }).style.color).toBe("#0000ff");
    // The number used to stay, and the design check crashed on it.
    expect(() => checkProject(p)).not.toThrow();
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "style.color", at: 0, color: "#ffffff" });
    p = runCommand(p, "set_param", { clip_ids: [id], path: "style.color", value: 0xff0000, at: 1 });
    expect(clips(p)[0].keyframes!["style.color"].map((k) => [k.f, k.v])).toEqual([[0, 0xffffff], [30, 0xff0000]]);
    expect(() => runCommand(p, "set_param", { clip_ids: [id], path: "style.font", value: 3 })).toThrow(/holds "Inter", not a number/);
    expect(() => runCommand(p, "set_param", { clip_ids: [id], path: "style.bold", value: 0 })).toThrow(/a boolean, not a number/);
    const q = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 1 });
    expect(() => runCommand(q, "set_param", { clip_ids: [clips(q)[0].id], path: "color", value: 5 })).toThrow(/not a number/);
    expect(() => runCommand(q, "set_param", { clip_ids: [clips(q)[0].id], path: "style.color", value: 5 })).toThrow(/a title's color/);
    // Numbers still set as before.
    p = runCommand(p, "set_param", { clip_ids: [id], path: "style.size", value: 120 });
    expect((clips(p)[0] as Clip & { style: { size: number } }).style.size).toBe(120);
  });
});

describe("set_border (ADR-099)", () => {
  it("frames a picture, changes and keys the frame, and takes it off", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_border", { clip_ids: [id] });
    expect((clips(p)[0] as ColorClip).border).toEqual({ color: "#ffffff", width: 8, opacity: 1 });
    p = runCommand(p, "set_border", { clip_ids: [id], color: "#102030", width: 14, opacity: 0.7 });
    expect((clips(p)[0] as ColorClip).border).toEqual({ color: "#102030", width: 14, opacity: 0.7 });
    expect(described(p, id).border).toEqual({ color: "#102030", width: 14, opacity: 0.7 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "border.width", at: 0, value: 0 });
    p = runCommand(p, "set_border", { clip_ids: [id], width: 20, at: 1 });
    expect(clips(p)[0].keyframes!["border.width"].map((k) => [k.f, k.v])).toEqual([[0, 0], [30, 20]]);
    expect((clips(p)[0] as ColorClip).border!.width).toBe(14);
    // It survives a save and load.
    expect(clips(normalizeProject(JSON.parse(JSON.stringify(p))))).toEqual(clips(p));
    p = runCommand(p, "set_border", { clip_ids: [id], off: true });
    expect("border" in clips(p)[0]).toBe(false);
    expect(clips(p)[0].keyframes).toBeUndefined();
    expect(() => runCommand(p, "set_border", { clip_ids: [id], color: "chalk" })).toThrow(/not a color/);
    expect(() => runCommand(p, "add_keyframe", { clip_id: id, path: "border.width", at: 0, value: 4 })).toThrow(/set_border first/);
    const q = runCommand(fresh(), "add_adjustment_clip", { start: 0, duration: 1 });
    expect(() => runCommand(q, "set_border", { clip_ids: [clips(q)[0].id] })).toThrow(/no picture/);
  });

  it("describe_project shows a picture's mask as set_mask takes it", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 2 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "rectangle", width: 1, height: 1, radius: 0.25, feather: 0 });
    expect(described(p, id).mask).toEqual({ shape: "rectangle", x: 0, y: 0, width: 1, height: 1, radius: 0.25 });
  });
});

describe("set_param sets what a clip has, and only that (ADR-108)", () => {
  /** A video with every optional picture part, a title, an outlined
   * gradient shape and a sound with every effect, each animatable. */
  function everything(): { p: Project; ids: string[] } {
    let p: Project = {
      ...fresh(),
      assets: [
        { id: "v", kind: "video", name: "v.mp4", src: "v.mp4", duration: 10, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true },
        { id: "s", kind: "audio", name: "s.wav", src: "s.wav", duration: 10, hasVideo: false, hasAudio: true },
      ],
      luts: [{ id: "l1", name: "Teal.cube", src: "teal.cube", kind: "3d", size: 33 }],
    };
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 4 });
    const v = clips(p)[0].id;
    p = runCommand(p, "set_shadow", { clip_ids: [v] });
    p = runCommand(p, "set_border", { clip_ids: [v] });
    p = runCommand(p, "set_mask", { clip_ids: [v], shape: "rectangle" });
    p = runCommand(p, "set_colorize", { clip_ids: [v] });
    p = runCommand(p, "apply_lut", { clip_id: v, lut_id: "l1" });
    p = runCommand(p, "add_effect", { clip_id: v, type: "blur" });
    for (const target of ["position", "x", "y", "rotation", "scale"]) p = runCommand(p, "set_wiggle", { clip_ids: [v], target, amplitude: 4 });
    p = runCommand(p, "add_text", { text: "Title", start: 0, duration: 4 });
    p = runCommand(p, "add_shape", { kind: "rounded_rectangle", start: 0, duration: 4, stroke_width: 6, gradient: { from: "#000000", to: "#ffffff", angle: 0, kind: "radial" } });
    p = runCommand(p, "add_media_clip", { asset_id: "s", start: 0, duration: 4 });
    const s = clips(p).find((c) => c.type === "audio")!.id;
    for (const type of ["lowpass", "highpass"]) p = runCommand(p, "set_audio_filter", { clip_ids: [s], type, cutoff: 800 });
    p = runCommand(p, "set_reverb", { clip_ids: [s], mix: 0.2 });
    p = runCommand(p, "set_echo", { clip_ids: [s], mix: 0.2 });
    return { p, ids: clips(p).map((c) => c.id) };
  }

  it("still sets every animatable number on a clip that has its part", () => {
    const { p, ids } = everything();
    // Every path the keyframe table lists, its choices spelled out.
    const expand = (path: string): string[] => {
      const m = /<([^>]+)>/.exec(path);
      if (!m) return [path];
      const choices = m[1] === "index|id|type" ? ["0"] : m[1] === "param" ? ["amount"] : m[1].split("|");
      return choices.flatMap((c) => expand(path.replace(m[0], c)));
    };
    const stored = (id: string, path: string) => {
      const c = clips(p).find((x) => x.id === id) as Clip & { effects?: { id: string }[] };
      return path.startsWith("effects.") ? (c.effects?.length ? `effects.${c.effects[0].id}.amount` : "effects") : path;
    };
    const unset: string[] = [];
    for (const path of ANIMATABLE_PATHS.flatMap(expand)) {
      // The clips this path animates on (a key on it would show there).
      const on = ids.filter((id) => !keyframeProblem(clips(p).find((c) => c.id === id)!, stored(id, path)));
      if (!on.length) unset.push(path);
      for (const id of on) {
        // style.color takes 0xRRGGBB, the rest a plain number.
        const value = path === "style.color" ? 0x336699 : path.endsWith("cutoff") ? 900 : 0.5;
        expect(() => runCommand(p, "set_param", { clip_ids: [id], path, value }), `${path} on ${id}`).not.toThrow();
      }
    }
    // Every row was tried on some clip but the vertical scale, which keys
    // only once the scale is not uniform...
    expect(unset).toEqual(["transform.scaleY"]);
    // ...and which set_param sets on a uniform picture, making it non-uniform.
    const q = runCommand(p, "set_param", { clip_ids: [ids[0]], path: "transform.scaleY", value: 0.5 });
    expect((clips(q)[0] as Clip & { transform: { scaleY?: number } }).transform.scaleY).toBe(0.5);
  });

  it("refuses a part the clip lacks, naming what adds it, instead of storing half of one", () => {
    let p: Project = { ...fresh(), assets: [{ id: "v", kind: "video", name: "v.mp4", src: "v.mp4", duration: 10, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] };
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 4 });
    p = runCommand(p, "add_shape", { kind: "rectangle", start: 0, duration: 4 });
    const [v, shape] = [clips(p).find((c) => c.type === "video")!.id, clips(p).find((c) => c.type === "color")!.id];
    // A half border, shadow, colorize or mask: the colorize crashed every
    // frame (a missing color), the mask every describe_project and undo.
    for (const [path, adds] of [
      ["border.width", "set_border first"],
      ["shadow.blur", "set_shadow first"],
      ["adjust.colorize.amount", "set_colorize first"],
      ["mask.width", "set_mask first"],
      ["adjust.lut.intensity", "apply_lut first"],
      ["chromaKey.similarity", "it has no chromaKey"],
    ]) expect(() => runCommand(p, "set_param", { clip_ids: [v], path, value: 0.5 }), path).toThrow(adds);
    expect(() => runCommand(p, "set_param", { clip_ids: [shape], path: "shape.stroke.width", value: 6 })).toThrow("set_shape stroke_width first");
    expect(() => runCommand(p, "set_param", { clip_ids: [shape], path: "shape.gradient.angle", value: 6 })).toThrow("set_shape gradient first");
    // A grade's own values start their part, as set_param says: the grade
    // reads what is not there as 0.
    p = runCommand(p, "set_param", { clip_ids: [v], path: "adjust.hsl.red.saturation", value: 20 });
    p = runCommand(p, "set_param", { clip_ids: [v], path: "adjust.wheels.gain.y", value: 10 });
    // So do a sound's EQ bands: a band not there plays flat.
    p = runCommand(p, "set_param", { clip_ids: [v], path: "eq.low", value: -12 });
    expect(clips(p).find((c) => c.id === v)).toMatchObject({ eq: { low: -12 } });
    expect(() => describeProject(p)).not.toThrow();
    expect(() => checkProject(p)).not.toThrow();
  });

  it("set_border, set_shadow, set_colorize and set_mask refuse a keyed value without at", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 4 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_border", { clip_ids: [id], width: 10 });
    p = runCommand(p, "set_shadow", { clip_ids: [id] });
    p = runCommand(p, "set_colorize", { clip_ids: [id] });
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "circle" });
    for (const path of ["border.width", "shadow.blur", "adjust.colorize.amount", "mask.width"]) {
      p = runCommand(p, "add_keyframe", { clip_id: id, path, at: 0, value: 0.2 });
      p = runCommand(p, "add_keyframe", { clip_id: id, path, at: 2, value: 0.4 });
    }
    // Without at the value went under the keys, where nothing shows it,
    // and the answer told it as set.
    expect(() => runCommand(p, "set_border", { clip_ids: [id], width: 30 })).toThrow(/border.width is keyframed.*give at/);
    expect(() => runCommand(p, "set_shadow", { clip_ids: [id], blur: 30 })).toThrow(/shadow.blur is keyframed/);
    expect(() => runCommand(p, "set_colorize", { clip_ids: [id], amount: 0.3 })).toThrow(/adjust.colorize.amount is keyframed/);
    expect(() => runCommand(p, "set_mask", { clip_ids: [id], width: 0.3 })).toThrow(/mask.width is keyframed/);
    // What is not keyed still changes without at, and at keys what is.
    const q = runCommand(p, "set_border", { clip_ids: [id], color: "#ff0000", opacity: 0.5 });
    expect((clips(q)[0] as ColorClip).border).toMatchObject({ color: "#ff0000", opacity: 0.5 });
    const r = runCommand(p, "set_border", { clip_ids: [id], width: 30, at: 1 });
    expect(clips(r)[0].keyframes!["border.width"].map((k) => [k.f, k.v])).toEqual([[0, 0.2], [30, 30], [60, 0.4]]);
  });

  it("set_mask none takes the mask's keys with it", () => {
    let p = runCommand(fresh(), "add_shape", { kind: "rectangle", start: 0, duration: 4 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "circle" });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "mask.width", at: 0, value: 0.2 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "opacity", at: 0, value: 1 });
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "none" });
    expect(Object.keys(clips(p)[0].keyframes ?? {})).toEqual(["opacity"]);
    // A new mask starts as set_mask makes it, not on the old one's keys.
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "rectangle", width: 0.9 });
    expect(described(p, id).mask).toMatchObject({ shape: "rectangle", width: 0.9 });
    expect(clips(p)[0].keyframes!["mask.width"]).toBeUndefined();
  });
});
