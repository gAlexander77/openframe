// Generate the test media every drive and manual check uses, with ffmpeg.
// Output: fixtures/media/ (gitignored; rerun any time). Each file covers a
// case the editor must handle: the common codecs, a phone-style rotated
// video, audio-only formats, stills, and codecs the webview cannot decode
// (ProRes) that the desktop app must route to a proxy.
//
//   node scripts/make-fixtures.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(import.meta.dirname, "..", "fixtures", "media");
mkdirSync(out, { recursive: true });

const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

// A frame counter and a timestamp burned in, so a screenshot proves which
// source frame is on screen.
const burn = (w, h, rate, extra = "") =>
  `testsrc2=size=${w}x${h}:rate=${rate},drawtext=text='%{pts\\:hms} f%{n}':fontsize=${Math.round(h / 12)}:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-th-${Math.round(h / 10)}${extra}`;
const tone = (freq, seconds) => `sine=frequency=${freq}:sample_rate=48000:duration=${seconds}`;

const jobs = {
  "h264-1080p30.mp4": () =>
    ff("-f", "lavfi", "-i", burn(1920, 1080, 30), "-f", "lavfi", "-i", tone(440, 10), "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "60", "-c:a", "aac", "-shortest", join(out, "h264-1080p30.mp4")),
  "h264-720p60-longgop.mp4": () =>
    ff("-f", "lavfi", "-i", burn(1280, 720, 60), "-f", "lavfi", "-i", tone(660, 8), "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "480", "-c:a", "aac", "-shortest", join(out, "h264-720p60-longgop.mp4")),
  "vp9-opus.webm": () =>
    ff("-f", "lavfi", "-i", burn(1280, 720, 30), "-f", "lavfi", "-i", tone(550, 6), "-t", "6", "-c:v", "libvpx-vp9", "-b:v", "1M", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-shortest", join(out, "vp9-opus.webm")),
  "h264-aac.mkv": () =>
    ff("-f", "lavfi", "-i", burn(1280, 720, 25), "-f", "lavfi", "-i", tone(330, 5), "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(out, "h264-aac.mkv")),
  "hevc-1080p.mp4": () =>
    ff("-f", "lavfi", "-i", burn(1920, 1080, 30), "-t", "4", "-c:v", "libx265", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", join(out, "hevc-1080p.mp4")),
  "phone-portrait-rotated.mp4": () => {
    // Stored landscape with a 90-degree display matrix, like iPhone footage.
    const tmp = join(out, "_landscape.mp4");
    ff("-f", "lavfi", "-i", burn(1920, 1080, 30), "-f", "lavfi", "-i", tone(880, 5), "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", tmp);
    ff("-display_rotation:v:0", "-90", "-i", tmp, "-c", "copy", join(out, "phone-portrait-rotated.mp4"));
  },
  "prores-422.mov": () =>
    ff("-f", "lavfi", "-i", burn(1920, 1080, 24), "-f", "lavfi", "-i", tone(220, 3), "-t", "3", "-c:v", "prores_ks", "-profile:v", "2", "-c:a", "pcm_s16le", "-shortest", join(out, "prores-422.mov")),
  "music-30s.mp3": () =>
    ff("-f", "lavfi", "-i", "aevalsrc='0.4*sin(2*PI*(220+110*floor(mod(t,4)))*t)*(0.6+0.4*sin(2*PI*2*t))':s=48000:d=30", "-c:a", "libmp3lame", "-b:a", "192k", join(out, "music-30s.mp3")),
  "voice-8s.wav": () =>
    ff("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*180*t)*gt(sin(2*PI*0.5*t),0)':s=48000:d=8", "-c:a", "pcm_s16le", join(out, "voice-8s.wav")),
  "speech-gaps.m4a": () =>
    ff("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*300*t)*lt(mod(t,3),1.6)':s=48000:d=12", "-c:a", "aac", join(out, "speech-gaps.m4a")),
  // Frame number in binary as ten black/white blocks across the picture:
  // the drives read pixels back to prove exactly which source frame shows.
  "framecode-30.mp4": () =>
    ff("-f", "lavfi", "-i", "color=c=black:size=640x360:rate=30,format=gray,geq=lum='255*mod(floor(N/pow(2,floor(X*10/W))),2)'", "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "90", "-bf", "2", join(out, "framecode-30.mp4")),
  // Real synthesized speech with a known script, for auto captions.
  "speech-test.wav": () =>
    ff("-f", "lavfi", "-i", "flite=text='Welcome to the video editor. This sentence was spoken by a computer. Captions should appear on screen.':voice=slt", "-ar", "48000", "-ac", "1", join(out, "speech-test.wav")),
  "photo.png": () => ff("-f", "lavfi", "-i", "testsrc2=size=1600x1200", "-frames:v", "1", join(out, "photo.png")),
  "photo.jpg": () => ff("-f", "lavfi", "-i", "mandelbrot=size=1920x1080", "-frames:v", "1", join(out, "photo.jpg")),
  "green-screen.mp4": () =>
    ff("-f", "lavfi", "-i", "color=c=0x00b140:size=1280x720:rate=30,drawbox=x=440:y=160:w=400:h=400:color=0xff3b6b@1:t=fill", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(out, "green-screen.mp4")),
  // AI tools (scripts/drive/ai-tools.js). Hard cuts at 2.5, 5, 8 and 10 s
  // (frames 75, 150, 240, 300 at 30 fps) between five different sources,
  // two of them moving, for scene detection.
  "scene-cuts.mp4": () => {
    const shots = [["testsrc2", 2.5], ["mandelbrot", 2.5], ["smptehdbars", 3], ["testsrc", 2], ["color=c=0x204080", 2]];
    const inputs = shots.flatMap(([src, d]) => ["-f", "lavfi", "-t", String(d), "-i", `${src}${src.includes("=") ? ":" : "="}size=640x360:rate=30`]);
    const graph = `${shots.map((_, i) => `[${i}:v]`).join("")}concat=n=${shots.length}:v=1:a=0,format=yuv420p[v]`;
    ff(...inputs, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-g", "60", join(out, "scene-cuts.mp4"));
  },
  // A drum loop at exactly 128 BPM from 0.25 s: a decaying kick on every
  // beat and a high-passed noise hat on every off-beat, for beat detection.
  "beat-128.m4a": () => {
    const b = 60 / 128;
    const kick = `0.8*sin(2*PI*90*mod(t-0.25,${b}))*exp(-mod(t-0.25,${b})/0.06)*gte(t,0.25)`;
    const hat = `0.5*(2*random(0)-1)*exp(-mod(t-0.25-${b / 2},${b})/0.015)*gte(t,0.25+${b / 2})`;
    ff("-f", "lavfi", "-i", `aevalsrc='${kick}':s=44100:d=20`, "-f", "lavfi", "-i", `aevalsrc='${hat}':s=44100:d=20`, "-filter_complex", "[1]highpass=f=6000[h];[0][h]amix=inputs=2:normalize=0", "-c:a", "aac", "-b:a", "160k", join(out, "beat-128.m4a"));
  },
  // A talking-head stand-in: picture plus the speech-gaps pattern (1.6 s of
  // tone every 3 s), for removing silences from a video with its sound.
  "talk-gaps.mp4": () =>
    ff("-f", "lavfi", "-i", burn(640, 360, 30), "-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*300*t)*lt(mod(t,3),1.6)':s=48000:d=12", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-shortest", join(out, "talk-gaps.mp4")),
};

const only = process.argv.slice(2);
for (const [name, make] of Object.entries(jobs)) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  process.stdout.write(`${name} ... `);
  try {
    make();
    console.log("ok");
  } catch (e) {
    console.log(`FAILED (${e.message.split("\n")[0]})`);
  }
}
