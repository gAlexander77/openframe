// The launch film's structure, as its edit and its music were made
// (docs/research/Launch film through MCP 2026-10-18.md, and the music's
// cue sheet: 120 BPM, so one bar is exactly two seconds). The hero shows it
// as the film's own timeline: picture chapters over the music's sections.
import type { Hue } from "../lib/features";

export type Chapter = { start: number; end: number; label: string; text: string; hue: Hue | "neutral" };
export type Section = { start: number; end: number; label: string; lufs: number };

export const FILM = {
  duration: 56,
  src: "media/launch-film.mp4",
  captions: "media/launch-film.en.vtt",
  title: "OpenFrame launch film",
};

/** Picture chapters, with the words on screen in each. */
export const CHAPTERS: Chapter[] = [
  { start: 0, end: 8, label: "Hook", text: "Pro editing. Zero friction. Open source. AI built in.", hue: "neutral" },
  { start: 8, end: 12, label: "OpenFrame", text: "The OpenFrame logo and wordmark: the open video editor AI can drive.", hue: "neutral" },
  { start: 12, end: 16, label: "Cut", text: "Cut. Split, trim, ripple: a clip is split and trimmed on the timeline.", hue: "cyan" },
  { start: 16, end: 20, label: "Color", text: "Color. Wheels, curves, LUTs: the color wheels warm a waterfall.", hue: "blue" },
  { start: 20, end: 24, label: "Motion", text: "Motion. Titles that move: CITY LIGHTS rises in letter by letter.", hue: "violet" },
  { start: 24, end: 26, label: "Captions", text: "Captions. Word by word: each word lights up as it is spoken.", hue: "violet" },
  { start: 26, end: 28, label: "Effects", text: "Effects. Glow, blur, glitch.", hue: "cyan" },
  { start: 28, end: 30, label: "Sound", text: "Sound. Filters, reverb, loudness.", hue: "green" },
  { start: 30, end: 32, label: "Everything", text: "Everything. One timeline: the whole editor.", hue: "neutral" },
  { start: 32, end: 36, label: "Then there's AI", text: "Then there's AI.", hue: "blue" },
  { start: 36, end: 40, label: "Live over MCP", text: "Any AI agent can edit. Live, over MCP. Every edit, live: an agent fills a timeline.", hue: "blue" },
  { start: 40, end: 44, label: "Edited by an agent", text: "This film was edited by an AI agent. Made with OpenFrame's MCP tools.", hue: "blue" },
  { start: 44, end: 46, label: "Export", text: "Export. Ready for every platform: the export ring runs to Export complete.", hue: "green" },
  { start: 46, end: 48, label: "Every screen", text: "Every screen. 16:9, 9:16, 1:1, 4:5: the canvas turns vertical.", hue: "green" },
  { start: 48, end: 56, label: "End card", text: "OpenFrame. Free and open source. github.com/gAlexander77/openframe", hue: "neutral" },
];

/** The music's sections, synthesized for the film, with each section's
 * measured loudness (ungated LUFS over the section, from the music's notes):
 * the track draws each section that loud. */
export const MUSIC: Section[] = [
  { start: 0, end: 4, label: "Intro", lufs: -20.5 },
  { start: 4, end: 8, label: "Build", lufs: -17.5 },
  { start: 8, end: 24, label: "Drop", lufs: -13.3 },
  { start: 24, end: 32, label: "Variation", lufs: -13.2 },
  { start: 32, end: 36, label: "Breakdown", lufs: -17.1 },
  { start: 36, end: 48, label: "Drop", lufs: -12.3 },
  { start: 48, end: 56, label: "Outro", lufs: -21.2 },
];

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
