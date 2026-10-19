// Undo labels are user-facing, even when an agent issued the command.
const LABELS: Record<string, string> = {
  add_media_clip: "Add clip", set_param: "Change parameter", set_text: "Edit text",
  set_project: "Project settings", batch: "Edit clips", edit_compound: "Edit compound clip",
  set_hsl: "Change HSL", apply_lut: "Apply LUT", set_chroma_key: "Change chroma key",
};
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").toLowerCase();
export function commandLabel(name: string, args: unknown = {}): string {
  if (name === "set_param" && args && typeof args === "object" && "path" in args && typeof args.path === "string") {
    return `Change ${words(args.path.split(".").pop()!)}`;
  }
  const label = LABELS[name] ?? words(name).replace(/^set /, "change ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
