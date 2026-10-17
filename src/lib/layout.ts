// The editor's panel sizes as fractions of the window (UX-30): CapCut keeps
// proportions, so a bigger screen gives the timeline and player the room
// instead of leaving it empty. Saved per viewer, never in the project.

export interface Layout {
  /** Library width, of the window width. */
  left: number;
  /** Inspector width, of the window width. */
  right: number;
  /** Top row (library, player, inspector) height, of the window height. */
  top: number;
}

export const LAYOUT_PRESETS = {
  default: { label: "Default", layout: { left: 0.29, right: 0.225, top: 0.55 } },
  preview: { label: "Large preview", layout: { left: 0.2, right: 0.2, top: 0.66 } },
  timeline: { label: "Large timeline", layout: { left: 0.27, right: 0.22, top: 0.42 } },
} satisfies Record<string, { label: string; layout: Layout }>;
export type LayoutPreset = keyof typeof LAYOUT_PRESETS;
export const DEFAULT_LAYOUT: Layout = LAYOUT_PRESETS.default.layout;

/** A saved layout, or the default. Before proportions it was saved in
 * pixels (any value over 1): read those against the current window. */
export function readLayout(raw: unknown, width: number, height: number): Layout {
  const o = (typeof raw === "object" && raw ? raw : {}) as Partial<Record<keyof Layout, unknown>>;
  const part = (v: unknown, of: number, fallback: number) =>
    typeof v === "number" && v > 0 ? Math.min(0.9, v > 1 ? v / Math.max(1, of) : v) : fallback;
  return {
    left: part(o.left, width, DEFAULT_LAYOUT.left),
    right: part(o.right, width, DEFAULT_LAYOUT.right),
    top: part(o.top, height, DEFAULT_LAYOUT.top),
  };
}

export const toPixels = (l: Layout, width: number, height: number) => ({
  left: Math.round(l.left * width),
  right: Math.round(l.right * width),
  top: Math.round(l.top * height),
});
