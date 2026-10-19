// Generate the test media every drive and manual check uses, with ffmpeg.
// Output: fixtures/media/ (gitignored; rerun any time). Each file covers a
// case the editor must handle: the common codecs, a phone-style rotated
// video, audio-only formats, stills, and codecs the webview cannot decode
// (ProRes) that the desktop app must route to a proxy.
//
//   node scripts/make-fixtures.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(import.meta.dirname, "..", "fixtures", "media");
mkdirSync(out, { recursive: true });

const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

// A frame counter and a timestamp burned in, so a screenshot proves which
// source frame is on screen.
const burn = (w, h, rate, extra = "") =>
  `testsrc2=size=${w}x${h}:rate=${rate},drawtext=text='%{pts\\:hms} f%{n}':fontsize=${Math.round(h / 12)}:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-th-${Math.round(h / 10)}${extra}`;
// Color bars for the grading drive: 75% bars on top (the vectorscope's 75%
// targets), 100% bars below, and a 256-step gray ramp at the bottom for
// curves and wheels. Bar order: white, yellow, cyan, green, magenta, red,
// blue, black. Exact 8-bit values, so pixels can be checked to the unit.
const bars = () => {
  const bar = "floor(X/240)";
  const on = (list) => `(${list.map((n) => `eq(${bar},${n})`).join("+")})`;
  const level = "if(lt(Y,540),191,255)";
  const ramp = "floor(X*256/W)";
  const ch = (list) => `if(lt(Y,810),${level}*${on(list)},${ramp})`;
  return `color=c=black:s=1920x1080,format=gbrp,geq=r='${ch([0, 1, 4, 5])}':g='${ch([0, 1, 2, 3])}':b='${ch([0, 2, 4, 6])}'`;
};

// .cube LUTs for the grading drive, written directly (no ffmpeg needed).
const cube3d = (size, fn) => {
  const rows = [`TITLE "${fn.name}"`, `LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) rows.push(fn(r / (size - 1), g / (size - 1), b / (size - 1)).map((v) => v.toFixed(6)).join(" "));
  return rows.join("\n") + "\n";
};
const cube1d = (size, fn) => {
  const rows = [`LUT_1D_SIZE ${size}`];
  for (let i = 0; i < size; i++) rows.push(fn(i / (size - 1)).map((v) => v.toFixed(6)).join(" "));
  return rows.join("\n") + "\n";
};
const identity = (r, g, b) => [r, g, b];
const invert = (r, g, b) => [1 - r, 1 - g, 1 - b];

const tone = (freq, seconds) => `sine=frequency=${freq}:sample_rate=48000:duration=${seconds}`;

// The take both sync fixtures hear: 20 s of synthesized speech, made once.
const syncMaster = () => {
  const master = join(out, "_sync-master.wav");
  const text = "Okay we are rolling. Today I want to show you how this camera handles low light. Watch the shadows on the left side of the frame. Now I will count to five so we can line up the sound later. One. Two. Three. Four. Five. That was it. Let us move on to the next shot.";
  if (!existsSync(master)) ff("-f", "lavfi", "-i", `flite=text='${text}':voice=slt`, "-af", "aresample=48000,apad=whole_dur=20", "-ac", "1", "-c:a", "pcm_s16le", master);
  return master;
};

const jobs = {
  "animated.apng": () => ff("-f", "lavfi", "-i", "testsrc=size=24x24:rate=5:duration=1,format=rgba,pad=32:32:4:4:color=black@0", "-plays", "0", "-f", "apng", join(out, "animated.apng")),
  "animated.gif": () => ff("-f", "lavfi", "-i", "testsrc=size=24x24:rate=5:duration=1,format=rgba,pad=32:32:4:4:color=black@0", "-filter_complex", "[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128", "-loop", "0", join(out, "animated.gif")),
  "animated.webp": () => ff("-f", "lavfi", "-i", "testsrc=size=24x24:rate=5:duration=1,format=rgba,pad=32:32:4:4:color=black@0", "-c:v", "libwebp_anim", "-lossless", "1", "-loop", "0", join(out, "animated.webp")),
  "h264-1080p30.mp4": () =>
    ff("-f", "lavfi", "-i", burn(1920, 1080, 30), "-f", "lavfi", "-i", tone(440, 10), "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "60", "-c:a", "aac", "-shortest", join(out, "h264-1080p30.mp4")),
  "h264-720p60-longgop.mp4": () =>
    ff("-f", "lavfi", "-i", burn(1280, 720, 60), "-f", "lavfi", "-i", tone(660, 8), "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "480", "-c:a", "aac", "-shortest", join(out, "h264-720p60-longgop.mp4")),
  // ffmpeg's default key frame interval at 30 fps (8 s): key frames at 0 and
  // 8 s only, so a clip that starts at 7 s decodes 210 frames before its
  // first one. Busy 1080p picture (decoding costs what real footage costs)
  // with the frame number in ten blocks across the top band, as in
  // framecode-30.mp4. The long-GOP playback drive cuts into it.
  "longgop-1080p30.mp4": () =>
    ff("-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "color=c=black:size=1920x120:rate=30,format=gray,geq=lum='255*mod(floor(N/pow(2,floor(X*10/W))),2)',format=yuv420p", "-f", "lavfi", "-i", tone(500, 10), "-filter_complex", "[0][1]overlay=0:0:shortest=1,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-t", "10", "-c:v", "libx264", "-preset", "medium", "-g", "240", "-keyint_min", "240", "-sc_threshold", "0", "-bf", "2", "-c:a", "aac", "-shortest", join(import.meta.dirname, "..", "scratch", "longgop-1080p30.mp4")),
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
  // Stereo with the right channel 8 dB down: loudness must sum channels.
  "music-stereo.m4a": () =>
    ff("-f", "lavfi", "-i", "aevalsrc='0.4*sin(2*PI*(220+110*floor(mod(t,4)))*t)*(0.6+0.4*sin(2*PI*2*t))|0.16*sin(2*PI*(220+110*floor(mod(t,4)))*t)*(0.6+0.4*sin(2*PI*2*t))':s=48000:d=12", "-c:a", "aac", "-b:a", "160k", join(out, "music-stereo.m4a")),
  // A lav recorded on one side: a tone on the left, silence on the right
  // (the channel fill drive).
  "left-only.wav": () =>
    ff("-f", "lavfi", "-i", "aevalsrc='0.4*sin(2*PI*440*t)|0':s=48000:d=3", "-c:a", "pcm_s16le", join(out, "left-only.wav")),
  "voice-8s.wav": () =>
    ff("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*180*t)*gt(sin(2*PI*0.5*t),0)':s=48000:d=8", "-c:a", "pcm_s16le", join(out, "voice-8s.wav")),
  "speech-gaps.m4a": () =>
    ff("-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*300*t)*lt(mod(t,3),1.6)':s=48000:d=12", "-c:a", "aac", join(out, "speech-gaps.m4a")),
  // Frame number in binary as ten black/white blocks across the picture:
  // the drives read pixels back to prove exactly which source frame shows.
  "framecode-30.mp4": () =>
    ff("-f", "lavfi", "-i", "color=c=black:size=640x360:rate=30,format=gray,geq=lum='255*mod(floor(N/pow(2,floor(X*10/W))),2)'", "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "90", "-bf", "2", join(out, "framecode-30.mp4")),
  // A white flash (frames 15-17 of every second) and a 1 kHz beep starting
  // on the same instant (0.5 s into every second, 100 ms long): the speed
  // drive proves sound stays on picture through ramps and reverse.
  "flash-beep-30.mp4": () =>
    ff("-f", "lavfi", "-i", "color=c=black:size=320x180:rate=30,format=gray,geq=lum='255*between(mod(N,30),15,17)'", "-f", "lavfi", "-i", "aevalsrc='0.8*sin(2*PI*1000*t)*between(mod(t,1),0.5,0.6)':s=48000:d=10", "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-b:a", "192k", join(out, "flash-beep-30.mp4")),
  // Real synthesized speech with a known script, for auto captions.
  "speech-test.wav": () =>
    ff("-f", "lavfi", "-i", "flite=text='Welcome to the video editor. This sentence was spoken by a computer. Captions should appear on screen.':voice=slt", "-ar", "48000", "-ac", "1", join(out, "speech-test.wav")),
  "photo.png": () => ff("-f", "lavfi", "-i", "testsrc2=size=1600x1200", "-frames:v", "1", join(out, "photo.png")),
  "photo.jpg": () => ff("-f", "lavfi", "-i", "mandelbrot=size=1920x1080", "-frames:v", "1", join(out, "photo.jpg")),
  "color-bars.png": () => ff("-f", "lavfi", "-i", bars(), "-frames:v", "1", "-pix_fmt", "rgb24", join(out, "color-bars.png")),
  "identity-33.cube": () => writeFileSync(join(out, "identity-33.cube"), cube3d(33, identity)),
  "invert-17.cube": () => writeFileSync(join(out, "invert-17.cube"), cube3d(17, invert)),
  "sqrt-1d.cube": () => writeFileSync(join(out, "sqrt-1d.cube"), cube1d(1024, (v) => [Math.sqrt(v), Math.sqrt(v), Math.sqrt(v)])),
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
  // Handheld shake for stabilization (scripts/drive/stabilize.js): a still
  // photo seen through a window that jitters 40 x 30 px every frame, so
  // the true motion is known; needs photo.jpg (made above).
  "shaky.mp4": () =>
    ff("-loop", "1", "-i", join(out, "photo.jpg"), "-vf", "scale=1600:-2,crop=1280:720:x='160+40*sin(n*1.9)':y='(ih-720)/2+30*cos(n*2.3)',format=yuv420p", "-t", "4", "-r", "30", "-c:v", "libx264", "-g", "30", join(out, "shaky.mp4")),
  // A talking-head stand-in: picture plus the speech-gaps pattern (1.6 s of
  // tone every 3 s), for removing silences from a video with its sound.
  "talk-gaps.mp4": () =>
    ff("-f", "lavfi", "-i", burn(640, 360, 30), "-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*300*t)*lt(mod(t,3),1.6)':s=48000:d=12", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-shortest", join(out, "talk-gaps.mp4")),
  // Sync audio by waveform (scripts/drive/audio-sync.js): one take heard by
  // two microphones. The camera's own sound is thin and roomy (high-passed,
  // with echoes) and AAC; the lav's is warm (low-passed), quieter, with
  // pink noise, and its recorder started earlier: a moment at camera
  // second t is at lav second t + 1.37. Both come from one speech master.
  "sync-camera.mp4": () =>
    ff("-f", "lavfi", "-i", burn(640, 360, 30), "-i", syncMaster(), "-filter_complex", "[1:a]atrim=start=2:duration=12,asetpts=PTS-STARTPTS,highpass=f=250,aecho=0.8:0.7:35|80:0.35|0.2[a]", "-map", "0:v", "-map", "[a]", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-b:a", "128k", join(out, "sync-camera.mp4")),
  "sync-lav.wav": () =>
    ff("-i", syncMaster(), "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.02:sample_rate=48000:seed=7", "-filter_complex", "[0:a]atrim=start=0.63,asetpts=PTS-STARTPTS,lowpass=f=4000,volume=0.35[v];[v][1:a]amix=inputs=2:duration=first:normalize=0", "-ac", "1", "-c:a", "pcm_s16le", join(out, "sync-lav.wav")),
  // Remove background (scripts/drive/bg-removal.js) needs a real person:
  // the segmentation model is trained on portraits. The photo is CC0
  // ("Siva Vaidhyanathan.jpg", Wikimedia Commons, by Siva Vaidhyanathan,
  // https://commons.wikimedia.org/wiki/File:Siva_Vaidhyanathan.jpg), a man
  // in a checked jacket against yellow foliage and a white column. It is
  // scaled to 1215x810 and a 960x540 window pans across it one pixel a
  // frame (x = 255 - n, y = 135), so the drive knows where every point of
  // the photo is on every frame: face and jacket must stay, foliage and
  // column must go.
  "person-pan.mp4": async () => {
    const photo = join(out, "_cc0-portrait.jpg");
    if (!existsSync(photo)) {
      const res = await fetch("https://upload.wikimedia.org/wikipedia/commons/f/fb/Siva_Vaidhyanathan.jpg", { headers: { "User-Agent": "video-editor-fixtures/0.1" } });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      writeFileSync(photo, Buffer.from(await res.arrayBuffer()));
    }
    ff("-loop", "1", "-framerate", "30", "-i", photo, "-vf", "scale=1215:810,crop=960:540:'255-n':135,format=yuv420p", "-frames:v", "180", "-c:v", "libx264", "-g", "30", "-crf", "18", join(out, "person-pan.mp4"));
  },
};

const only = process.argv.slice(2);
for (const [name, make] of Object.entries(jobs)) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  process.stdout.write(`${name} ... `);
  try {
    await make();
    console.log("ok");
  } catch (e) {
    console.log(`FAILED (${e.message.split("\n")[0]})`);
  }
}
