// Makes the README's animated GIFs (docs/media/*.gif): a teaser of the launch
// film, the feature loops the site plays, and an agent building a project
// live, filmed by `capture.mjs --record`, AI agent notices and all.
//
//   node scripts/make-readme-media.mjs --agent <capture recording.webm> --from <s> --to <s> [--only name,name]
//   (--from and --to: where capture.mjs printed the agent's build starts and ends)
//
// Needs ffmpeg on PATH. GIF, not video: GitHub plays a README's GIFs in the
// page but not a video committed to the repository. Each is palette-built
// (one palette per GIF, frames diffed) to stay a few megabytes. Look at
// every frame before a commit (docs/Website.md, "Privacy checklist").
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "../docs/media");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []),
);
const only = args.only ? new Set(args.only.split(",")) : null;
const media = (f) => join(ROOT, "public/media", f);

const GIFS = [
  // The film's beats: the wordmark, a feature window, the agent live, the end card.
  { name: "launch-film-teaser", src: media("launch-film.mp4"), segments: [[8.1, 11.6], [12.3, 15.4], [40.3, 43.6], [60.1, 63.9]], width: 720, fps: 12 },
  ...["cut", "color", "titles", "captions"].map((name) => ({ name, src: media(`loops/${name}.mp4`), width: 720, fps: 12 })),
  ...(args.agent ? [{ name: "agent-live", src: resolve(args.agent), segments: [[+args.from, +args.to]], width: 960, fps: 10, speed: 1.5 }] : []),
];

for (const g of GIFS) {
  if (only && !only.has(g.name)) continue;
  const cut = g.segments
    ? g.segments.map(([a, b], i) => `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${g.speed ?? 1}[s${i}]`).join(";") +
      `;${g.segments.map((_, i) => `[s${i}]`).join("")}concat=n=${g.segments.length}:v=1:a=0[v];[v]`
    : "[0:v]";
  const filter = `${cut}fps=${g.fps},scale=${g.width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  const out = join(OUT, `${g.name}.gif`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", g.src, "-filter_complex", filter, "-map_metadata", "-1", "-loop", "0", out], { stdio: "inherit" });
  console.log(`${g.name}.gif ${(statSync(out).size / 1e6).toFixed(1)} MB`);
}
