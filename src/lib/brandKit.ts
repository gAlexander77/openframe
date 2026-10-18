// The brand kit: an ad's colors by role, its two fonts and its logos, kept
// in the project (Project.brand) so every title, button, badge and end card
// an agent or a person adds agrees with the rest. Text roles turn the kit
// into title styles (add_text's role, apply_brand); ad elements (lib/ads.ts)
// build on the same roles. Readable text over a color is chosen by WCAG
// contrast, so a button's label never disappears into its fill.

import type { Brand, Id, Project, TextStyle } from "./project/types";

/** What an unbranded project uses: a neutral blue, near-black and a warm
 * yellow, in the app's default font. */
export const DEFAULT_BRAND: Brand = {
  colors: { primary: "#2563eb", secondary: "#1e293b", accent: "#facc15", background: "#0b1020", text: "#ffffff" },
  fonts: { heading: "Inter", body: "Inter" },
};

export const brandOf = (p: Project): Brand => p.brand ?? DEFAULT_BRAND;

export type ColorRole = keyof Brand["colors"];
export const COLOR_ROLES: ColorRole[] = ["primary", "secondary", "accent", "background", "text"];

export type TextRole = "headline" | "subhead" | "body" | "label" | "cta" | "badge";
export const TEXT_ROLES: TextRole[] = ["headline", "subhead", "body", "label", "cta", "badge"];

export type LogoVariant = "main" | "light" | "dark" | "icon";
export const LOGO_VARIANTS: LogoVariant[] = ["main", "light", "dark", "icon"];

// ---- colors -------------------------------------------------------------------------

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080", transparent: "#00000000" };

/** A CSS color as 0..255 RGB and 0..1 alpha: hex (3, 4, 6 or 8 digits),
 * rgb()/rgba() or a few names. Null for anything else. */
export function parseColor(c: string): { r: number; g: number; b: number; a: number } | null {
  const s = (NAMED[c.trim().toLowerCase()] ?? c).trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (fn) {
    const a = fn[4] === undefined ? 1 : fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    return { r: +fn[1], g: +fn[2], b: +fn[3], a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(c: string): number {
  const v = parseColor(c);
  if (!v) return 0.5;
  const lin = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(v.r) + 0.7152 * lin(v.g) + 0.0722 * lin(v.b);
}

/** WCAG contrast ratio of two colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on `fill`. */
export const readableOn = (fill: string) => (contrast("#ffffff", fill) >= contrast("#111111", fill) ? "#ffffff" : "#111111");

/** `preferred` when it reaches 4.5:1 on `fill` (WCAG AA for text), else
 * whichever of white and near-black reads. */
export const textOn = (fill: string, preferred: string) => (contrast(preferred, fill) >= 4.5 ? preferred : readableOn(fill));

/** A color at an opacity, as #rrggbbaa. */
export function withAlpha(c: string, a: number): string {
  const v = parseColor(c);
  if (!v) return c;
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(v.r)}${h(v.g)}${h(v.b)}${h(a * 255)}`;
}

// ---- type -------------------------------------------------------------------------------

/** How big ad type runs on this canvas: sizes are pixels at a 1080-tall
 * frame, so a tall frame (9:16) would make a headline far wider than its
 * frame; this keeps it to the same share of the width as on 4:5. */
export const typeScale = (width: number, height: number) => Math.min(1, (1.2 * width) / height);

/** The smallest text that reads on a phone, as a style size (pixels at a
 * 1080-tall canvas): 40 px on a frame whose short side is 1080, so 40 on
 * 16:9 and 1:1, 32 on 4:5 and 22.5 on 9:16, where the canvas is 1920 tall
 * but the phone shows its 1080 width. */
export const minTextSize = (width: number, height: number) => (40 * Math.min(width, height)) / height;

/** A soft shadow that lifts light type off busy footage (firm enough for
 * white over a bright, busy shot; the ad drive's contact sheet asked). */
export const LIFT = { color: "#000000cc", blur: 22, x: 0, y: 4 };

/** The style a text role takes from the brand. Headlines run about 9% of
 * the frame's height (ad typography: 8 to 12%); type over footage gets a
 * shadow, and labels on fills pick a readable color. */
export function roleStyle(b: Brand, role: TextRole, k = 1): Partial<TextStyle> {
  const c = b.colors;
  const size = (n: number) => Math.round(n * k);
  switch (role) {
    case "headline":
      return { font: b.fonts.heading, size: size(100), bold: true, color: c.text, shadow: LIFT, lineHeight: 1.1 };
    case "subhead":
      return { font: b.fonts.body, size: size(54), bold: false, color: c.text, shadow: LIFT };
    case "body":
      return { font: b.fonts.body, size: size(42), bold: false, color: c.text, shadow: LIFT };
    case "label":
      // A kicker in a small accent box: colored type alone vanished over
      // a busy shot of a similar color.
      return { font: b.fonts.heading, size: size(40), bold: true, letterSpacing: 4, case: "upper", color: readableOn(c.accent), background: { color: c.accent, padding: 10, radius: 6 } };
    case "cta":
      return { font: b.fonts.heading, size: size(56), bold: true, color: readableOn(c.primary), background: { color: c.primary, padding: 30, radius: 999 } };
    case "badge":
      return { font: b.fonts.heading, size: size(80), bold: true, color: readableOn(c.accent), background: { color: c.accent, padding: 26, radius: 22 }, lineHeight: 1 };
  }
}

/** A title restyled by the brand. With a role, that role's whole look
 * (and size); without, only fonts and colors change: the heading font for
 * bold display type, a box takes the primary color with a readable label,
 * plain type the brand's text color, and any glow, gradient or sweep color
 * the accent. Words, size and layout stay. */
export function brandedStyle(s: TextStyle, b: Brand, role?: TextRole, k = 1): TextStyle {
  if (role) {
    const look = roleStyle(b, role, k);
    const out: TextStyle = { ...s, ...look };
    // A role without a box or shadow drops the old ones.
    if (!look.background) delete out.background;
    if (!look.shadow) delete out.shadow;
    for (const kk of ["gradient", "glow", "stroke2"] as const) delete out[kk];
    if (!look.case) delete out.case;
    if (look.letterSpacing === undefined) out.letterSpacing = 0;
    return out;
  }
  const c = b.colors;
  const out: TextStyle = { ...s, font: s.bold && s.size >= 60 ? b.fonts.heading : b.fonts.body, accent: c.accent };
  if (s.background) {
    out.background = { ...s.background, color: c.primary };
    out.color = readableOn(c.primary);
  } else out.color = c.text;
  if (s.glow) out.glow = { ...s.glow, color: c.accent };
  if (s.gradient) out.gradient = { ...s.gradient, from: c.primary, to: c.accent };
  if (s.highlight) out.highlight = c.accent;
  return out;
}

/** The logo asset to draw on `fill` (undefined: over footage): the light
 * variant on a dark fill, the dark one on a light fill, else the main one;
 * or the variant asked for, falling back to main. */
export function pickLogo(b: Brand, variant: LogoVariant | "auto", fill?: string): Id | undefined {
  const l = b.logos;
  if (!l) return undefined;
  if (variant !== "auto") return l[variant] ?? l.main;
  if (fill === undefined) return l.main ?? l.light ?? l.dark ?? l.icon;
  return (luminance(fill) < 0.35 ? l.light : l.dark) ?? l.main ?? l.icon;
}

// ---- the project's kit ------------------------------------------------------------------

/** What set_brand changes; an empty string removes an optional part. */
export interface BrandPatch {
  name?: string;
  colors?: Partial<Brand["colors"]>;
  fonts?: Partial<Brand["fonts"]>;
  logos?: Partial<Record<LogoVariant, string>>;
  url?: string;
  tagline?: string;
}

/** The brand with a patch applied, checked: colors must parse, logos must
 * be imported pictures. Throws a message an agent can act on. */
export function patchBrand(p: Project, patch: BrandPatch): Brand {
  const base = p.brand ?? DEFAULT_BRAND;
  for (const [role, v] of Object.entries(patch.colors ?? {})) {
    if (v !== undefined && !parseColor(v)) throw new Error(`${role} must be a CSS color such as #ff3366 or rgb(255, 51, 102), not ${JSON.stringify(v)}`);
  }
  const logos: Partial<Record<LogoVariant, string>> = { ...base.logos };
  for (const [variant, id] of Object.entries(patch.logos ?? {}) as [LogoVariant, string | undefined][]) {
    if (id === undefined) continue;
    if (id === "") {
      delete logos[variant];
      continue;
    }
    const a = p.assets.find((x) => x.id === id);
    if (!a) throw new Error(`no asset with id ${id}: import the logo first (import_media), then pass its id`);
    if (a.kind !== "image") throw new Error(`the ${variant} logo must be a picture (a PNG with transparency works best); ${a.name} is ${a.kind}`);
    logos[variant] = id;
  }
  const opt = (k: "name" | "url" | "tagline") => (patch[k] === undefined ? base[k] : patch[k] || undefined);
  const out: Brand = {
    colors: { ...base.colors, ...Object.fromEntries(Object.entries(patch.colors ?? {}).filter(([, v]) => v !== undefined)) },
    fonts: { ...base.fonts, ...Object.fromEntries(Object.entries(patch.fonts ?? {}).filter(([, v]) => v)) },
  };
  for (const k of ["name", "url", "tagline"] as const) {
    const v = opt(k);
    if (v) out[k] = v;
  }
  if (Object.keys(logos).length) out.logos = logos;
  return out;
}

/** A brand from project JSON, or undefined when it is not one. Colors and
 * fonts missing fill from the defaults; logos whose asset is gone drop. */
export function normalizeBrand(raw: unknown, assetIds: Set<string>): Brand | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const pick = <T extends Record<string, string>>(v: unknown, base: T): T => {
    const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(base).map(([k, d]) => [k, typeof o[k] === "string" && o[k] ? (o[k] as string) : d])) as T;
  };
  const out: Brand = { colors: pick(r.colors, DEFAULT_BRAND.colors), fonts: pick(r.fonts, DEFAULT_BRAND.fonts) };
  if (typeof r.logos === "object" && r.logos !== null) {
    const logos = Object.fromEntries(LOGO_VARIANTS.flatMap((v) => {
      const id = (r.logos as Record<string, unknown>)[v];
      return typeof id === "string" && assetIds.has(id) ? [[v, id]] : [];
    }));
    if (Object.keys(logos).length) out.logos = logos;
  }
  for (const k of ["name", "url", "tagline"] as const) if (typeof r[k] === "string" && r[k]) out[k] = r[k] as string;
  return out;
}
