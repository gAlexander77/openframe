import { describe, expect, it } from "vitest";
import { brandedStyle, contrast, DEFAULT_BRAND, normalizeBrand, parseColor, pickLogo, readableOn, roleStyle, textOn, typeScale, withAlpha } from "./brandKit";
import { describeProject, runCommand } from "./commands";
import { createProject, DEFAULT_TEXT_STYLE, normalizeProject } from "./project/defaults";
import type { Project, TextClip } from "./project/types";

const withLogo = (): Project => ({
  ...createProject(),
  assets: [
    { id: "logo", kind: "image", name: "logo.png", src: "logo.png", duration: 0, width: 600, height: 300, hasVideo: true, hasAudio: false },
    { id: "clip", kind: "video", name: "a.mp4", src: "a.mp4", duration: 5, width: 1920, height: 1080, hasVideo: true, hasAudio: true },
  ],
});

describe("colors", () => {
  it("parses hex, rgb() and names", () => {
    expect(parseColor("#f36")).toEqual({ r: 255, g: 51, b: 102, a: 1 });
    expect(parseColor("#ff336680")!.a).toBeCloseTo(0.5, 2);
    expect(parseColor("rgba(10, 20, 30, 0.4)")).toEqual({ r: 10, g: 20, b: 30, a: 0.4 });
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("nope")).toBeNull();
  });

  it("measures WCAG contrast and picks readable text", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21);
    expect(readableOn("#facc15")).toBe("#111111");
    expect(readableOn("#2563eb")).toBe("#ffffff");
    expect(textOn("#0b1020", "#ffffff")).toBe("#ffffff");
    // A brand's text color that would not read on its fill gives way.
    expect(textOn("#ffffff", "#f5f5f5")).toBe("#111111");
    expect(withAlpha("#0b1020", 0.9)).toBe("#0b1020e6");
  });
});

describe("type and roles", () => {
  it("keeps tall-frame type to the width it has", () => {
    expect(typeScale(1920, 1080)).toBe(1);
    expect(typeScale(1080, 1080)).toBe(1);
    expect(typeScale(1080, 1920)).toBeCloseTo(0.675);
  });

  it("styles roles from the brand: headline about 9% of the frame, buttons readable", () => {
    const b = { ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, primary: "#ffd23f" }, fonts: { heading: "Impact", body: "Georgia" } };
    expect(roleStyle(b, "headline")).toMatchObject({ font: "Impact", size: 100, bold: true });
    expect(roleStyle(b, "body").font).toBe("Georgia");
    expect(roleStyle(b, "cta")).toMatchObject({ color: "#111111", background: { color: "#ffd23f" } });
    expect(roleStyle(b, "headline", 0.5).size).toBe(50);
  });

  it("rebrands a title's fonts and colors only, or its whole look by role", () => {
    const b = { ...DEFAULT_BRAND, fonts: { heading: "Impact", body: "Georgia" } };
    const boxed = brandedStyle({ ...DEFAULT_TEXT_STYLE, size: 40, bold: false, background: { color: "#000", padding: 10, radius: 4 } }, b);
    expect(boxed).toMatchObject({ font: "Georgia", size: 40, color: "#ffffff", background: { color: DEFAULT_BRAND.colors.primary, padding: 10 } });
    const big = brandedStyle({ ...DEFAULT_TEXT_STYLE, size: 120, glow: { color: "#0f0", blur: 10 } }, b);
    expect(big).toMatchObject({ font: "Impact", glow: { color: DEFAULT_BRAND.colors.accent } });
    const badge = brandedStyle({ ...DEFAULT_TEXT_STYLE, shadow: { color: "#000", blur: 4, x: 0, y: 2 } }, b, "badge");
    expect(badge.background?.color).toBe(DEFAULT_BRAND.colors.accent);
    expect(badge.shadow).toBeUndefined();
  });

  it("picks the logo variant that shows on the fill", () => {
    const b = { ...DEFAULT_BRAND, logos: { main: "m", light: "l", dark: "d" } };
    expect(pickLogo(b, "auto", "#000000")).toBe("l");
    expect(pickLogo(b, "auto", "#ffffff")).toBe("d");
    expect(pickLogo(b, "auto")).toBe("m");
    expect(pickLogo({ ...DEFAULT_BRAND, logos: { main: "m" } }, "icon")).toBe("m");
    expect(pickLogo(DEFAULT_BRAND, "auto")).toBeUndefined();
  });
});

describe("set_brand", () => {
  it("merges what is given and shows in describe_project", () => {
    let p = runCommand(withLogo(), "set_brand", { name: "Roast", primary: "#ff3366", heading_font: "Impact", logo: "logo", url: "roast.example" });
    p = runCommand(p, "set_brand", { accent: "#00e5ff" });
    expect(p.brand).toMatchObject({ name: "Roast", url: "roast.example", colors: { primary: "#ff3366", accent: "#00e5ff", background: DEFAULT_BRAND.colors.background }, fonts: { heading: "Impact", body: "Inter" }, logos: { main: "logo" } });
    expect(describeProject(p).brand).toEqual(p.brand);
    p = runCommand(p, "set_brand", { logo: "", url: "" });
    expect(p.brand!.logos).toBeUndefined();
    expect(p.brand!.url).toBeUndefined();
    expect(runCommand(p, "set_brand", { reset: true }).brand).toEqual(DEFAULT_BRAND);
  });

  it("refuses colors that are not colors and logos that are not pictures", () => {
    expect(() => runCommand(withLogo(), "set_brand", { primary: "bright pink" })).toThrow(/CSS color/);
    expect(() => runCommand(withLogo(), "set_brand", { logo: "clip" })).toThrow(/picture/);
    expect(() => runCommand(withLogo(), "set_brand", { logo: "gone" })).toThrow(/import the logo first/);
  });

  it("survives a save and load, dropping a logo whose picture is gone", () => {
    const p = runCommand(withLogo(), "set_brand", { primary: "#123456", logo: "logo" });
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).brand).toEqual(p.brand);
    expect(normalizeBrand({ colors: { primary: "#123456" }, logos: { main: "gone" } }, new Set())).toEqual({ colors: { ...DEFAULT_BRAND.colors, primary: "#123456" }, fonts: DEFAULT_BRAND.fonts });
    expect(normalizeBrand("nope", new Set())).toBeUndefined();
  });
});

describe("add_text role and apply_brand", () => {
  it("starts a title from a brand role, then the given style", () => {
    let p = runCommand(createProject(), "set_brand", { primary: "#ff3366", heading_font: "Impact" });
    p = runCommand(p, "add_text", { text: "Order now", start: 0, duration: 2, role: "cta", style: { size: 70 } });
    const s = (p.tracks.flatMap((t) => t.clips)[0] as TextClip).style;
    expect(s).toMatchObject({ font: "Impact", size: 70, background: { color: "#ff3366", radius: 999 } });
  });

  it("restyles titles and solids, and refuses other clips or the wrong kind of role", () => {
    let p = runCommand(withLogo(), "add_text", { text: "Hi", start: 0, duration: 2 });
    p = runCommand(p, "add_color_clip", { color: "#000", start: 0, duration: 2 });
    p = runCommand(p, "add_media_clip", { asset_id: "clip", start: 0 });
    p = runCommand(p, "set_brand", { primary: "#ff3366", secondary: "#222244", heading_font: "Impact" });
    const clips = () => p.tracks.flatMap((t) => t.clips);
    const text = clips().find((c) => c.type === "text")!.id, color = clips().find((c) => c.type === "color")!.id, video = clips().find((c) => c.type === "video")!.id;
    p = runCommand(p, "apply_brand", { clip_ids: [text], role: "headline" });
    p = runCommand(p, "apply_brand", { clip_ids: [color], role: "secondary" });
    expect((clips().find((c) => c.id === text) as TextClip).style).toMatchObject({ font: "Impact", size: 100 });
    expect(clips().find((c) => c.id === color)).toMatchObject({ color: "#222244" });
    expect(() => runCommand(p, "apply_brand", { clip_ids: [video] })).toThrow(/titles and solid colors/);
    expect(() => runCommand(p, "apply_brand", { clip_ids: [text], role: "primary" })).toThrow(/color role/);
  });
});
