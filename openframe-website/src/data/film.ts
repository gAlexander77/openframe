// The launch film's structure, as its edit and its score were made
// (docs/research/Launch film 3 through MCP 2026-10-19.md, and the score's
// cue sheet: 120 BPM in F minor, so one bar is exactly two seconds). The
// hero shows it as the film's own timeline: picture chapters over the
// score's sections. The narration is read from the captions file
// (FilmTranscript.astro), so the captions and the transcript cannot drift.
import type { Hue } from "../lib/features";

export type Chapter = { start: number; end: number; label: string; text: string; hue: Hue | "neutral" };
export type Section = { start: number; end: number; label: string; lufs: number };

export const FILM = {
  duration: 68,
  src: "media/launch-film.mp4",
  captions: "media/launch-film.en.vtt",
  title: "OpenFrame launch film",
};

/** Picture chapters: the words on screen in each, then what is shown. */
export const CHAPTERS: Chapter[] = [
  { start: 0, end: 8, label: "Hook", text: "Every video editor makes you choose. Easy. Powerful: the home screen and the full editor, side by side.", hue: "neutral" },
  { start: 8, end: 12, label: "OpenFrame", text: "The OpenFrame logo and wordmark: the open video editor AI can drive.", hue: "neutral" },
  { start: 12, end: 16, label: "Cut", text: "Cut. Magnetic timeline: the editor in a floating window, its timeline full of clips and titles.", hue: "cyan" },
  { start: 16, end: 20, label: "Color", text: "Color. Real color: the color wheels regrade a waterfall, close up.", hue: "blue" },
  { start: 20, end: 24, label: "Motion", text: "Motion. Motion paths: keyframes and their value graph under the player.", hue: "violet" },
  { start: 24, end: 28, label: "Words", text: "Words. Style every word: one word of the title BEYOND BLUE turns blue.", hue: "violet" },
  { start: 28, end: 32, label: "Sound", text: "Sound. Mix it. Score it: the mixer's faders under an aerial shot.", hue: "green" },
  { start: 32, end: 36, label: "Layouts", text: "Layouts. One-click layouts: two aerial shots become a split screen.", hue: "cyan" },
  { start: 36, end: 40, label: "One thing", text: "One thing no other editor can do.", hue: "blue" },
  { start: 40, end: 45, label: "Live over MCP", text: "AI agents. Live, over MCP: an agent fills an empty project's timeline shot by shot and titles it OPEN WATER.", hue: "blue" },
  { start: 45, end: 52, label: "Undo", text: "Undo. Every change, undoable: the AI assistant titles a skyline NIGHT FALLS, and both changes undo in one step.", hue: "blue" },
  { start: 52, end: 60, label: "Made with OpenFrame", text: "Made with OpenFrame. Cut, scored and narrated by an AI agent: a timeline with music and voice tracks, then its export.", hue: "green" },
  { start: 60, end: 68, label: "End card", text: "OpenFrame. Free and open source. github.com/gAlexander77/openframe", hue: "neutral" },
];

/** The score's sections, as generate_music answered them (seed 3101), each
 * with its loudness: the energy mean of ffmpeg's ebur128 momentary loudness
 * (400 ms windows wholly inside the section, ungated). It was measured on
 * the score alone, re-rendered from the film's own generate_music arguments
 * and seed (the generator is deterministic, ADR-085, and the re-render's
 * master report matched the film's), so it is the music before it was
 * ducked under the voice. The film's mix measures -14.2 LUFS integrated.
 * The track draws each section that loud. */
export const MUSIC: Section[] = [
  { start: 0, end: 8, label: "Intro", lufs: -19.1 },
  { start: 8, end: 12, label: "Drop", lufs: -12.9 },
  { start: 12, end: 36, label: "Verse", lufs: -13.8 },
  { start: 36, end: 40, label: "Breakdown", lufs: -18.9 },
  { start: 40, end: 52, label: "Drop", lufs: -12.2 },
  { start: 52, end: 60, label: "Verse", lufs: -14.5 },
  { start: 60, end: 68, label: "Outro", lufs: -15.7 },
];

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
