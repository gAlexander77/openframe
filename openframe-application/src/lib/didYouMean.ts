// The argument (or tool) a model most likely meant when it named one that
// does not exist: seek({time: 11}) means `at`, set_text's style.fontSize
// means `size`. Validation names it beside the unknown one, so the retry is
// right the first time (the Codex film test, 2026-10-19; ADR-095).

/** Words models use for an argument these tools spell another way. Only
 * suggested when the tool really has the one on the right. */
const SYNONYMS: Record<string, string[]> = {
  time: ["at", "start"],
  seconds: ["at", "duration"],
  second: ["at"],
  t: ["at"],
  timestamp: ["at"],
  when: ["at"],
  position: ["at"],
  begin: ["start"],
  from: ["start", "in"],
  to: ["end"],
  until: ["end"],
  length: ["duration"],
  id: ["clip_id", "asset_id", "track_id"],
  ids: ["clip_ids"],
  clip: ["clip_id"],
  clips: ["clip_ids"],
  asset: ["asset_id"],
  media: ["asset_id"],
  track: ["track_id"],
  file: ["files", "src"],
  path: ["src", "folder"],
  dir: ["folder"],
  directory: ["folder"],
  output_dir: ["folder"],
  out_dir: ["folder"],
  output: ["folder"],
  font_size: ["size"],
  fontsize: ["size"],
  font_family: ["font"],
  font_weight: ["weight"],
  colour: ["color"],
  content: ["text"],
  title: ["text", "name"],
  label: ["name"],
  cols: ["columns"],
  width: ["max_width", "tile_width"],
  type: ["kind"],
  kind: ["type"],
};

/** clipId, clip-id and Clip_ID all read as clip_id. */
const norm = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length];
}

/**
 * The known name `name` most likely meant, or undefined when none is close:
 * the same name spelled another way (camelCase, a plural), a word these
 * tools say differently (time for at), or a near spelling (one or two
 * letters off, fewer for short names).
 */
export function didYouMean(name: string, known: readonly string[]): string | undefined {
  if (!known.length) return undefined;
  const n = norm(name);
  const byNorm = new Map(known.map((k) => [norm(k), k] as const));
  const hit = (k: string) => byNorm.get(k);
  const same = hit(n) ?? hit(`${n}s`) ?? hit(n.replace(/s$/, "")) ?? hit(`${n}_id`) ?? hit(`${n}_ids`) ?? hit(n.replace(/_ids?$/, ""));
  if (same) return same;
  for (const s of SYNONYMS[n] ?? []) if (hit(s)) return hit(s);
  const near = known.map((k) => ({ k, d: distance(n, norm(k)) })).sort((a, b) => a.d - b.d)[0];
  const allowed = n.length <= 3 ? 1 : n.length <= 6 ? 2 : 3;
  if (near.d <= allowed && near.d < norm(near.k).length) return near.k;
  // A part of a longer name: "max" for max_width, when only one has it.
  const parts = known.filter((k) => norm(k).split("_").includes(n));
  return parts.length === 1 ? parts[0] : undefined;
}
