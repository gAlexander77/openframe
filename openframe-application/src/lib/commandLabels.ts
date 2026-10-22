// Undo labels are user-facing, even when an agent issued the command: the
// AI agent's notice shows the same words (ADR-093).
import { enableLabel } from "./clipEnable";
import { paramLabel } from "./paramInfo";

const LABELS: Record<string, string> = {
  match_color: "Match color",
  add_media_clip: "Add clip", set_param: "Change parameter", set_text: "Edit text",
  set_project: "Project settings", batch: "Edit clips", edit_compound: "Edit compound clip",
  set_hsl: "Change HSL", apply_lut: "Apply LUT", set_chroma_key: "Change chroma key",
  set_colorize: "Colorize", set_crossfade: "Crossfade", set_anchor: "Pin to footage",
};
/** What `off: true` (or seconds 0, preset off) removes, by command (ADR-109). */
const REMOVES: Record<string, string> = {
  set_border: "Remove border", set_shadow: "Remove shadow", set_colorize: "Remove colorize", set_crossfade: "Remove crossfade", set_compressor: "Compressor off",
};
/** Path parts that only hold a parameter: "transform.scaleY" is the scale y. */
const HOLDERS = new Set(["transform", "adjust", "style", "effects"]);
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").toLowerCase();
/** A parameter as the keyframe panel names it ("border.width" is "border
 * width", "transform.x" "position x"), else by its path's last two parts,
 * so a border's width is never just "width" (ADR-109). */
const paramName = (path: string) => {
  const known = paramLabel(path);
  if (known) return known.toLowerCase();
  const parts = path.split(".").filter((s, i, all) => !HOLDERS.has(s) && all[i - 1] !== "effects");
  return words(parts.slice(-2).join(" ")).replace(/\beq\b/, "EQ");
};
const record = (args: unknown): Record<string, unknown> => (args && typeof args === "object" ? (args as Record<string, unknown>) : {});

export function commandLabel(name: string, args: unknown = {}): string {
  const a = record(args);
  if (name === "set_param" && typeof a.path === "string") return `Change ${paramName(a.path)}`;
  if (name === "set_clip_enabled" && typeof a.enabled === "boolean") return enableLabel(a.enabled, Array.isArray(a.clip_ids) ? Math.max(1, a.clip_ids.length) : 1);
  if (name === "set_anchor" && a.none === true) return "Unpin";
  if (REMOVES[name] && (a.off === true || a.seconds === 0 || a.preset === "off")) return REMOVES[name];
  const label = LABELS[name] ?? words(name).replace(/^set /, "change ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
