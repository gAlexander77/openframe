// The feature groups, each with one icon and one hue that it keeps wherever
// it appears (home, features page, docs). Icons are the app's own (Lucide
// drawings copied into src/icons/), the same ones the app shows for that
// part of the editor: the library tab, the toolbar button or the panel.
// Every claim here is from docs/Features.md; numbers come from getFacts().
import { getFacts } from "./docs";

export type Hue = "cyan" | "blue" | "violet" | "green";
export type Feature = {
  id: string;
  name: string;
  icon: string;
  hue: Hue;
  title: string;
  summary: string;
  where: string[];
  points: string[];
  loop?: string;
  shot?: string;
  alt: string;
};

const f = getFacts();
const n = (v: number | null, word: string) => (v ? `${v} ${word}` : word);

export const FEATURES: Feature[] = [
  {
    id: "editing",
    name: "Editing",
    icon: "scissors",
    hue: "cyan",
    title: "Cut fast. Trim to the frame.",
    summary: "CapCut's magnetic main track, snapping and linkage on top, Premiere's trim tools underneath.",
    where: ["Timeline"],
    points: [
      "A magnetic main track, snapping and linkage keep the edit tight; titles and sound effects follow their shot.",
      "Ripple, roll, slip, slide and rate stretch, with a two-up preview of the frames on each side of the cut.",
      "Compound clips, groups, linked picture and sound for J and L cuts, lift and extract, close gaps.",
      "Frame-exact playback on the audio clock, J, K and L shuttle, markers that export as YouTube chapters.",
    ],
    loop: "cut",
    alt: "A clip is split at the playhead on OpenFrame's timeline, and its new edge is dragged while a readout shows the duration.",
  },
  {
    id: "color",
    name: "Color",
    icon: "palette",
    hue: "blue",
    title: "Grade with real color tools.",
    summary: "Lift, gamma, gain and offset wheels, curves, HSL and LUTs, applied in Lumetri's order.",
    where: ["Inspector", "Adjust", "Color wheel"],
    points: [
      "Basic sliders, eight-range HSL, monotone curves and color wheels that agree with the vectorscope.",
      `1D and 3D .cube LUTs with an intensity; ${n(f.looks, "looks")}; adjustment layers grade everything below them.`,
      "A luma waveform, RGB parade, vectorscope and histogram of the graded picture.",
      "Auto adjust corrects exposure and white balance from the frame, and leaves a scene that is dark on purpose alone.",
    ],
    loop: "color",
    alt: "The Lift wheel is dragged toward teal and the Gamma wheel toward orange; the waterfall shot's shadows cool and its midtones warm.",
  },
  {
    id: "titles",
    name: "Titles and kinetic type",
    icon: "type",
    hue: "violet",
    title: "Type that moves.",
    summary: "Titles animate by letter, word or line, and you type them straight onto the picture.",
    where: ["Inspector", "Text", "Animation"],
    points: [
      "Typewriter, letter rise, word pop, highlight and underline sweeps, with a stagger and an order for any animation.",
      `${n(f.templates, "animated templates")} and ${n(f.wordArt, "word-art looks")}; glow, gradient fills and a second outline.`,
      "Double-click a title in the viewer and type: the frame redraws in the real style as you go.",
      "Shape layers that draw on, track mattes, motion blur from movement, wiggle, and spring, elastic and bounce eases.",
    ],
    loop: "titles",
    alt: "CITY LIGHTS is typed into a new title over a city at dusk, then plays in letter by letter with the Letter rise animation.",
  },
  {
    id: "captions",
    name: "Captions",
    icon: "captions",
    hue: "violet",
    title: "Captions, made on your computer.",
    summary: "Whisper transcribes on your machine: no upload, no limit, no subscription.",
    where: ["Library", "Captions"],
    points: [
      "Readable line breaks, or one word at a time for short-form video.",
      "The spoken word lights up; six caption looks restyle every caption in one click.",
      "Edit by transcript: select words, press Delete, and the cut is made with the pause around it.",
      "Find and replace across captions; SRT and VTT in and out.",
    ],
    loop: "captions",
    alt: "Captions in the Word pop look play over aerial footage, each word turning green as it is spoken.",
  },
  {
    id: "effects",
    name: "Effects and transitions",
    icon: "sparkles",
    hue: "cyan",
    title: "Effects that preview on your shot.",
    summary: `${n(f.effects, "effects")} and ${n(f.transitions, "transitions")}, drawn by the same engine that exports them.`,
    where: ["Library", "Effects"],
    points: [
      "Library cards preview each effect, filter and transition on the selected clip's own frame.",
      `Masks with feather and invert, ${n(f.blendModes, "blend modes")}, chroma key and adjustment layers.`,
      "Remove the background on your computer, then set a title behind the person.",
      "Whip pans, zoom punches and spin blurs hide the cut inside the move.",
    ],
    loop: "effects",
    alt: "The Glow effect is dropped on a skyline at dusk and the city lights bloom; its Amount and Threshold appear in the inspector.",
  },
  {
    id: "audio",
    name: "Audio and loudness",
    icon: "audio-lines",
    hue: "green",
    title: "Sound that is ready to publish.",
    summary: "A clean mix, measured the way platforms and broadcasters measure it.",
    where: ["Inspector", "Audio"],
    points: [
      "EQ, a compressor with Enhance voice, low- and high-pass filters, reverb, echo and tape stop, identical in preview and export.",
      "A live loudness meter in LUFS, and a report against online, EBU R128 or ATSC A/85 before you export.",
      "Normalize to -14, -16, -23 or -24 LUFS with a true-peak limiter.",
      "Ducking under speech, noise reduction, sync by waveform, voiceover recording and synthesized sound effects.",
    ],
    loop: "audio",
    alt: "On a music clip the Low-pass filter is on, Hall reverb is chosen and its mix raised, then playback runs with the level meter moving.",
  },
  {
    id: "ai-tools",
    name: "AI tools",
    icon: "wand-sparkles",
    hue: "blue",
    title: "AI that runs on your hardware.",
    summary: "Every model runs on your computer, downloaded once the first time you use it.",
    where: ["Library", "AI tools"],
    points: [
      "Remove silences and filler words, split scenes, beat markers, stabilize, auto reframe and motion tracking.",
      "Text to speech with Kokoro, and a voiceover from a script with captions timed to the voice.",
      "Remove background with a segmentation model on your GPU, or on the CPU when there is none.",
      "The AI assistant: describe an edit and a model on your computer (Ollama or LM Studio) makes it, undoable in one step.",
    ],
    shot: "ai-tools",
    alt: "The library's AI tools tab lists Remove silences, Remove filler words, Split scenes and Beat markers beside the player.",
  },
  {
    id: "export",
    name: "Export and deliverables",
    icon: "download",
    hue: "green",
    title: "Every format, every screen.",
    summary: "From one timeline to every shape, length and platform a campaign needs.",
    where: ["Export"],
    points: [
      "MP4, MOV, WebM and MKV in H.264, HEVC, VP9 or AV1, as your device encodes them; 480p to 4K.",
      "Presets for YouTube, TikTok, Reels and Shorts; animated GIF; audio only; a PNG of any frame.",
      "Versions in one step: 16:9, 9:16, 1:1 and 4:5, 30, 15 and 6 second cut-downs, a textless master.",
      "Timelines leave as OpenTimelineIO for DaVinci Resolve and Premiere; projects render from the command line.",
    ],
    loop: "export",
    alt: "The export runs from 0 to 100 percent with a frame count and time left, then the Export complete card appears.",
  },
  {
    id: "mcp",
    name: "MCP for agents",
    icon: "plug",
    hue: "blue",
    title: "Any AI agent can edit with you.",
    summary: "Turn on Allow AI agents and Claude Code, Codex or any MCP client works on your timeline, live.",
    where: ["AI assistant", "Connect agents"],
    points: [
      `${f.tools} MCP tools cover the whole job, from importing footage to exporting every version.`,
      "The agent sees its own work: rendered frames, contact sheets, motion strips and a check against design rules.",
      "Opt-in and token-locked; the server listens on 127.0.0.1, so only programs on your computer can reach it.",
      "Every agent edit appears on your timeline as it happens and can be undone.",
    ],
    loop: "agent",
    alt: "An agent fills an empty project over MCP: footage lands on the timeline, then music, a COASTLINE title, transitions, a warm look and beat markers.",
  },
];

export const feature = (id: string) => {
  const found = FEATURES.find((x) => x.id === id);
  if (!found) throw new Error("no feature " + id);
  return found;
};

/** Smaller capabilities, listed under the main groups on the features page. */
export const MORE = [
  { icon: "diamond", hue: "cyan" as Hue, title: "Keyframes and graphs", text: "Every number animates. A keyframe panel docked under the timeline shows lanes and a value graph with bezier handles." },
  { icon: "gauge", hue: "blue" as Hue, title: "Speed", text: "Constant speed from 0.1x to 100x, speed curves with presets, frame blending, and reverse with the sound reversed too." },
  { icon: "ratio", hue: "violet" as Hue, title: "Vertical and square", text: "Canvas presets for YouTube, TikTok, Reels, Shorts and feeds, any size up to 8192 pixels, and guides for the parts of a 9:16 frame the apps cover." },
  { icon: "sticker", hue: "green" as Hue, title: "Stickers", text: "About 140 stickers drawn on your computer, from arrows and badges to emoji, each an ordinary clip." },
  { icon: "keyboard", hue: "cyan" as Hue, title: "Keyboard first", text: "CapCut's shortcuts with Premiere's where CapCut has none, a searchable list, and every chord yours to change." },
  { icon: "clapperboard", hue: "blue" as Hue, title: "Projects", text: "Autosave after every change, a home screen of projects, open JSON files, and named copies for versions of an edit." },
];
