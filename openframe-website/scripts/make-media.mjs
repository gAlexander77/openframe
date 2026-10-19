// Makes the site's video media from the launch film and the recorded product
// footage: a web version of the film (H.264 1080p, +faststart) with its
// poster and captions, and short muted feature loops (VP9 WebM + H.264 MP4,
// 1280x720), each cropped to the part of the window that shows the feature.
//
//   node scripts/make-media.mjs --film "<launch film.mp4>" [--captions "<its .srt>"] --footage <dir> [--only name,name] [--posters 1]
//   (--posters 1 rewrites only the loops' poster frames from the encoded loops)
//
// Needs ffmpeg and ffprobe on PATH. Outputs (committed):
//   public/media/launch-film.mp4, public/media/launch-film.en.vtt,
//   public/media/loops/<name>.webm|.mp4
//   src/assets/media/launch-film-poster.jpg, src/assets/media/<name>.jpg
// Metadata is stripped from every file (no creation times, encoder paths or
// tags). Every frame still has to be looked at before a commit: see
// docs/Website.md, "Privacy checklist for media".
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []),
);
const only = args.only ? new Set(args.only.split(",")) : null;
const want = (name) => !only || only.has(name);

// The loops. Times are seconds in the source take; crop is the top-left
// corner and width of a 16:9 region, as fractions of the 16:9 frame (so
// the height fraction equals the width fraction). Regions come from the
// takes' SHOTS.md. Several segments are joined; speed > 1 plays faster.
export const LOOPS = [
  { name: "cut", src: "03-cut.mp4", segments: [[5.0, 11.4]], crop: [0.38, 0.56, 0.42], poster: 5.0 },
  { name: "color", src: "04-color.mp4", segments: [[3.6, 9.4]], crop: [0.345, 0.04, 0.655], poster: 5.6 },
  { name: "titles", src: "05-titles.mp4", segments: [[6.9, 9.7], [20.9, 24.0]], crop: [0.38, 0.05, 0.62], poster: 5.6 },
  { name: "captions", src: "06-captions.mp4", segments: [[8.0, 13.2]], crop: [0.3, 0.06, 0.46], poster: 2.4 },
  { name: "effects", src: "07-effects.mp4", segments: [[9.2, 15.4]], crop: [0.33, 0.1, 0.66], poster: 4.0 },
  { name: "audio", src: "08-audio.mp4", segments: [[10.8, 14.6], [16.8, 20.0]], crop: [0.55, 0.05, 0.45], poster: 5.0 },
  { name: "agent", src: "09-ai-agent.mp4", segments: [[4.8, 17.4]], crop: [0.04, 0.04, 0.9], speed: 2, poster: 6.2 },
  { name: "export", src: "10-export.mp4", segments: [[9.0, 20.8]], crop: [0.237, 0.1, 0.526], speed: 2, poster: 5.8 },
  { name: "vertical", src: "11-vertical.mp4", segments: [[1.8, 5.2], [10.0, 15.8]], crop: [0.32, 0.08, 0.43], speed: 1.25, poster: 6.8 },
];

const run = (cmd, a) => execFileSync(cmd, a, { stdio: ["ignore", "ignore", "pipe"] });
const mb = (f) => (statSync(f).size / 1e6).toFixed(2) + " MB";
const NOMETA = ["-map_metadata", "-1", "-map_chapters", "-1", "-fflags", "+bitexact"];
// The recordings are full-range (JPEG) YUV from the browser's screencast.
// Full-range VP9 fails to decode in Edge on Windows (PIPELINE_ERROR_DECODE
// on the first frame), so the loops are converted to limited range and
// tagged BT.709 like ordinary web video.
const COLOR = ["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];

function filmWeb(src) {
  const out = join(ROOT, "public/media/launch-film.mp4");
  // The two-pass log stays in the site's git-ignored scratch folder.
  mkdirSync(join(ROOT, ".cache"), { recursive: true });
  const log = join(ROOT, ".cache", "film-2pass");
  const v = ["-c:v", "libx264", "-preset", "slow", "-threads", "4", "-profile:v", "high", "-pix_fmt", "yuv420p", "-b:v", "1750k", "-maxrate", "3500k", "-bufsize", "7000k", "-g", "60", "-passlogfile", log];
  run("ffmpeg", ["-v", "error", "-y", "-i", src, ...v, "-pass", "1", "-an", "-f", "mp4", process.platform === "win32" ? "NUL" : "/dev/null"]);
  // The sound is the master's own mix, loudness-normalized on export: an
  // AAC track is copied as it is (re-encoding it raised the true peak from
  // -1.0 to -0.7 dBTP), anything else becomes AAC at 128 kbit/s.
  const acodec = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", src]).toString().trim();
  const audio = acodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k"];
  run("ffmpeg", ["-v", "error", "-y", "-i", src, ...v, "-pass", "2", ...audio, ...NOMETA, "-movflags", "+faststart", out]);
  for (const f of [log + "-0.log", log + "-0.log.mbtree"]) if (existsSync(f)) rmSync(f);
  // The poster: the wordmark and the line under it, settled.
  run("ffmpeg", ["-v", "error", "-y", "-ss", "10.6", "-i", src, "-frames:v", "1", "-q:v", "2", ...NOMETA, join(ROOT, "src/assets/media/launch-film-poster.jpg")]);
  console.log("launch-film.mp4", mb(out));
}

// The film's SubRip captions (export_video's captions: srt) as WebVTT for
// the player's <track>: the same cues, times with a dot, no cue numbers.
function captionsVtt(srt) {
  const blocks = readFileSync(srt, "utf8").replace(/^\uFEFF/, "").replace(/\r/g, "").trim().split(/\n{2,}/);
  const cues = blocks.map((block) => {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) throw new Error(`no cue times in: ${block}`);
    const time = lines[at].replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2");
    const text = lines.slice(at + 1).map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    return [time, ...text].join("\n");
  });
  const out = join(ROOT, "public/media/launch-film.en.vtt");
  const note = "NOTE The narration, from the film's own captions.";
  writeFileSync(out, ["WEBVTT", note, ...cues].join("\n\n") + "\n", "utf8");
  console.log("launch-film.en.vtt", cues.length, "cues");
}

function loop(dir, l) {
  const src = join(dir, l.src);
  const [x, y, w] = l.crop;
  const speed = l.speed ?? 1;
  // crop in source pixels (2560x1440 takes, but read the size to be safe)
  const [sw, sh] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src]).toString().trim().split(",").map(Number);
  const cw = Math.round((w * sw) / 2) * 2, ch = Math.round((w * sh) / 2) * 2;
  const cx = Math.round(x * sw), cy = Math.round(y * sh);
  const n = l.segments.length;
  const parts = l.segments.map(([a, b], i) => `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${speed},crop=${cw}:${ch}:${cx}:${cy},scale=1280:720:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,fps=30,format=yuv420p[${n > 1 ? "s" + i : "v"}]`);
  const filter = parts.join(";") + (n > 1 ? `;${parts.map((_, i) => `[s${i}]`).join("")}concat=n=${n}:v=1:a=0[v]` : "");
  const base = join(ROOT, "public/media/loops", l.name);
  mkdirSync(dirname(base), { recursive: true });
  if (!args.posters) run("ffmpeg", ["-v", "error", "-y", "-i", src, "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-threads", "4", "-maxrate", "2200k", "-bufsize", "4400k", "-profile:v", "high", "-g", "60", ...COLOR, ...NOMETA, "-movflags", "+faststart", base + ".mp4"]);
  if (!args.posters) run("ffmpeg", ["-v", "error", "-y", "-i", src, "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libvpx-vp9", "-crf", "32", "-threads", "4", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-g", "120", ...COLOR, ...NOMETA, base + ".webm"]);
  // poster: a settled frame of the loop, at the loop's own crop
  run("ffmpeg", ["-v", "error", "-y", "-i", base + ".mp4", "-ss", String(l.poster ?? 0), "-frames:v", "1", "-q:v", "2", ...NOMETA, join(ROOT, "src/assets/media", l.name + ".jpg")]);
  console.log(l.name.padEnd(10), "webm", mb(base + ".webm"), " mp4", mb(base + ".mp4"));
}

if (args.film && want("film")) filmWeb(args.film);
if (args.captions && want("film")) captionsVtt(args.captions);
if (args.footage) for (const l of LOOPS) if (want(l.name)) loop(args.footage, l);
if (!args.film && !args.footage) {
  console.error('usage: node scripts/make-media.mjs --film "<launch film.mp4>" --footage <footage dir> [--only film,cut,...]');
  process.exit(2);
}
