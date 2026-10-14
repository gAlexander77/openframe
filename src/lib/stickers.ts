// The sticker library: emoji drawn from the system's color emoji font, and
// graphics drawn in code (src/engine/stickers.ts) — arrows, circles,
// bubbles, badges. Nothing is downloaded (ADR-003). The first time a sticker
// is used in a project it is rendered to a PNG and becomes an ordinary image
// asset, so the project file stays plain media and looks the same on a
// machine with other fonts (ADR-025).

import { placeOnTop } from "./overlays";
import { clipForAsset } from "./project/defaults";
import type { Asset, Id, ImageClip, Project } from "./project/types";
import { secondsToFrames } from "./time";

/** Drawings src/engine/stickers.ts knows how to make. */
export type StickerArt =
  | "arrowCurved"
  | "arrow"
  | "arrowScribble"
  | "ring"
  | "underline"
  | "doubleUnderline"
  | "highlighter"
  | "emphasisLines"
  | "sparkles"
  | "burst"
  | "box"
  | "crossOut"
  | "speech"
  | "thought"
  | "shout"
  | "callout"
  | "chat"
  | "pill"
  | "bell"
  | "starBadge"
  | "saleTag"
  | "live"
  | "star"
  | "heart"
  | "check"
  | "cross"
  | "bolt"
  | "play"
  | "pin"
  | "question";

/** Small white glyphs a badge pill can lead with. */
export type BadgeIcon = "bell" | "heart" | "plus" | "share" | "check" | "cursor";

export const STICKER_CATEGORIES = [
  "Emphasis",
  "Callouts",
  "Badges",
  "Shapes",
  "Smileys",
  "Gestures",
  "Love",
  "Party",
  "Objects",
  "Nature",
] as const;
export type StickerCategory = (typeof STICKER_CATEGORIES)[number];

export interface StickerDef {
  /** Stable name: the asset remembers it, agents pass it to add_sticker. */
  id: string;
  label: string;
  category: StickerCategory;
  /** Extra words search matches. */
  tags: string;
  /** Emoji stickers: the character sequence drawn. */
  emoji?: string;
  /** Drawn stickers: the artwork, its main color and any words on it. */
  art?: StickerArt;
  color?: string;
  text?: string;
  icon?: BadgeIcon;
}

const emoji = (category: StickerCategory, list: [string, string, string, string?][]): StickerDef[] =>
  list.map(([char, id, label, tags = ""]) => ({ id, label, category, tags, emoji: char }));

const drawn = (category: StickerCategory, list: (Omit<StickerDef, "category" | "tags"> & { tags?: string })[]): StickerDef[] =>
  list.map((d) => ({ ...d, category, tags: d.tags ?? "" }));

const RED = "#ff3b30";
const YELLOW = "#ffd60a";
const WHITE = "#ffffff";

export const STICKERS: StickerDef[] = [
  ...drawn("Emphasis", [
    { id: "curved-arrow-red", label: "Curved arrow", art: "arrowCurved", color: RED, tags: "point look here" },
    { id: "curved-arrow-yellow", label: "Curved arrow", art: "arrowCurved", color: YELLOW, tags: "point look here" },
    { id: "curved-arrow-white", label: "Curved arrow", art: "arrowCurved", color: WHITE, tags: "point look here" },
    { id: "arrow-red", label: "Arrow", art: "arrow", color: RED, tags: "point right" },
    { id: "arrow-white", label: "Arrow", art: "arrow", color: WHITE, tags: "point right" },
    { id: "scribble-arrow", label: "Scribble arrow", art: "arrowScribble", color: WHITE, tags: "hand drawn doodle point" },
    { id: "circle-red", label: "Circle", art: "ring", color: RED, tags: "ring highlight hand drawn" },
    { id: "circle-yellow", label: "Circle", art: "ring", color: YELLOW, tags: "ring highlight hand drawn" },
    { id: "underline-red", label: "Underline", art: "underline", color: RED, tags: "swoosh brush" },
    { id: "double-underline", label: "Double underline", art: "doubleUnderline", color: YELLOW, tags: "swoosh" },
    { id: "highlighter", label: "Highlighter", art: "highlighter", color: YELLOW, tags: "marker" },
    { id: "box-red", label: "Box", art: "box", color: RED, tags: "rectangle frame highlight hand drawn" },
    { id: "cross-out", label: "Cross out", art: "crossOut", color: RED, tags: "x wrong no" },
    { id: "emphasis-lines", label: "Emphasis lines", art: "emphasisLines", color: WHITE, tags: "surprise shock radial" },
    { id: "sparkles-drawn", label: "Sparkles", art: "sparkles", color: YELLOW, tags: "shine twinkle magic" },
  ]),
  ...drawn("Callouts", [
    { id: "speech-bubble", label: "Speech bubble", art: "speech", color: WHITE, tags: "talk say comic" },
    { id: "thought-bubble", label: "Thought bubble", art: "thought", color: WHITE, tags: "think cloud comic" },
    { id: "shout-bubble", label: "Shout bubble", art: "shout", color: WHITE, tags: "yell loud comic spiky" },
    { id: "chat-bubble", label: "Chat bubble", art: "chat", color: "#0a84ff", tags: "message text" },
    { id: "callout-dark", label: "Callout", art: "callout", color: "#1c1c1e", tags: "label box pointer" },
    { id: "burst-wow", label: "Wow burst", art: "burst", color: YELLOW, text: "WOW!", tags: "comic explosion pow" },
    { id: "burst-boom", label: "Boom burst", art: "burst", color: "#ff9f0a", text: "BOOM!", tags: "comic explosion pow" },
    { id: "burst-omg", label: "OMG burst", art: "burst", color: "#ff375f", text: "OMG", tags: "comic explosion shock" },
  ]),
  ...drawn("Badges", [
    { id: "subscribe", label: "Subscribe", art: "pill", color: "#ff2d3d", text: "SUBSCRIBE", icon: "bell", tags: "button channel" },
    { id: "subscribed", label: "Subscribed", art: "pill", color: "#3a3a3c", text: "SUBSCRIBED", icon: "check", tags: "button channel done" },
    { id: "like", label: "Like", art: "pill", color: "#0a84ff", text: "LIKE", icon: "heart", tags: "button love" },
    { id: "follow", label: "Follow", art: "pill", color: "#ff2d78", text: "FOLLOW", icon: "plus", tags: "button social" },
    { id: "share", label: "Share", art: "pill", color: "#30b158", text: "SHARE", icon: "share", tags: "button send" },
    { id: "click-here", label: "Click here", art: "pill", color: "#1c1c1e", text: "CLICK HERE", icon: "cursor", tags: "button link" },
    { id: "bell", label: "Bell", art: "bell", color: "#ffcc00", tags: "notification ring alert subscribe" },
    { id: "new-badge", label: "New", art: "starBadge", color: RED, text: "NEW", tags: "starburst label" },
    { id: "sale-tag", label: "Sale", art: "saleTag", color: RED, text: "SALE", tags: "price tag discount shop" },
    { id: "live", label: "Live", art: "live", color: "#ff2d3d", text: "LIVE", tags: "stream broadcast" },
  ]),
  ...drawn("Shapes", [
    { id: "star-gold", label: "Star", art: "star", color: "#ffc93c", tags: "favorite rating" },
    { id: "heart-red", label: "Heart", art: "heart", color: "#ff375f", tags: "love like" },
    { id: "check-green", label: "Check", art: "check", color: "#30b158", tags: "yes done correct tick" },
    { id: "cross-red", label: "Cross", art: "cross", color: RED, tags: "no wrong x" },
    { id: "bolt", label: "Lightning", art: "bolt", color: YELLOW, tags: "energy power flash" },
    { id: "play-button", label: "Play", art: "play", color: "#1c1c1e", tags: "video watch button" },
    { id: "pin-red", label: "Map pin", art: "pin", color: RED, tags: "location place marker" },
    { id: "question", label: "Question", art: "question", color: "#5e5ce6", tags: "ask help faq" },
  ]),
  ...emoji("Smileys", [
    ["😀", "grinning", "Grinning", "happy smile"],
    ["😂", "joy", "Tears of joy", "laugh lol funny"],
    ["🤣", "rofl", "Rolling laughing", "laugh lol funny"],
    ["😊", "blush", "Blush", "smile happy"],
    ["😍", "heart-eyes", "Heart eyes", "love"],
    ["🥰", "smiling-hearts", "Smiling with hearts", "love adore"],
    ["😎", "cool", "Cool", "sunglasses"],
    ["🤩", "star-struck", "Star-struck", "wow amazing"],
    ["🥳", "party-face", "Party face", "celebrate birthday"],
    ["😮", "surprised", "Surprised", "wow oh"],
    ["😱", "scream", "Scream", "shock horror"],
    ["🤯", "mind-blown", "Mind blown", "wow shock"],
    ["😭", "crying", "Crying", "sad tears"],
    ["😢", "sad", "Sad", "tear"],
    ["😡", "angry", "Angry", "mad rage"],
    ["🤔", "thinking", "Thinking", "hmm question"],
    ["🙄", "eye-roll", "Eye roll", "annoyed whatever"],
    ["😴", "sleeping", "Sleeping", "tired zzz"],
    ["😅", "sweat-smile", "Sweat smile", "nervous phew"],
    ["😇", "halo", "Halo", "angel innocent"],
    ["🤫", "shush", "Shush", "quiet secret"],
    ["🥺", "pleading", "Pleading", "please cute"],
    ["💀", "skull", "Skull", "dead lol"],
    ["🫡", "salute", "Salute", "respect"],
  ]),
  ...emoji("Gestures", [
    ["👍", "thumbs-up", "Thumbs up", "like yes good"],
    ["👎", "thumbs-down", "Thumbs down", "dislike no bad"],
    ["👏", "clap", "Clap", "applause bravo"],
    ["🙌", "raised-hands", "Raised hands", "celebrate yay"],
    ["🙏", "pray", "Folded hands", "please thanks pray"],
    ["💪", "muscle", "Flexed biceps", "strong power"],
    ["👋", "wave", "Wave", "hi hello bye"],
    ["✌️", "peace", "Peace", "victory"],
    ["🤞", "fingers-crossed", "Fingers crossed", "luck hope"],
    ["👌", "ok-hand", "OK hand", "perfect"],
    ["👉", "point-right", "Point right", "this"],
    ["👈", "point-left", "Point left", "this"],
    ["👆", "point-up", "Point up", "this above"],
    ["👇", "point-down", "Point down", "this below"],
    ["👀", "eyes", "Eyes", "look watch see"],
    ["🫶", "heart-hands", "Heart hands", "love"],
  ]),
  ...emoji("Love", [
    ["❤️", "red-heart", "Red heart", "love"],
    ["🧡", "orange-heart", "Orange heart", "love"],
    ["💛", "yellow-heart", "Yellow heart", "love"],
    ["💚", "green-heart", "Green heart", "love"],
    ["💙", "blue-heart", "Blue heart", "love"],
    ["💜", "purple-heart", "Purple heart", "love"],
    ["🖤", "black-heart", "Black heart", "love"],
    ["💔", "broken-heart", "Broken heart", "sad breakup"],
    ["💕", "two-hearts", "Two hearts", "love"],
    ["💖", "sparkling-heart", "Sparkling heart", "love"],
    ["💘", "cupid", "Heart with arrow", "love cupid"],
    ["💋", "kiss", "Kiss", "lips love"],
  ]),
  ...emoji("Party", [
    ["🎉", "party-popper", "Party popper", "celebrate confetti tada"],
    ["🎊", "confetti", "Confetti ball", "celebrate"],
    ["🎈", "balloon", "Balloon", "birthday party"],
    ["🎁", "gift", "Gift", "present birthday"],
    ["🎂", "cake", "Birthday cake", "birthday"],
    ["🏆", "trophy", "Trophy", "win award champion"],
    ["🥇", "gold-medal", "Gold medal", "first win"],
    ["✨", "sparkles", "Sparkles", "shine magic"],
    ["🔥", "fire", "Fire", "hot lit trending"],
    ["💯", "hundred", "Hundred", "perfect score"],
    ["💥", "boom", "Collision", "boom explosion"],
    ["⭐", "star", "Star", "favorite"],
    ["🌟", "glowing-star", "Glowing star", "shine"],
    ["⚡", "zap", "High voltage", "lightning energy"],
  ]),
  ...emoji("Objects", [
    ["💡", "idea", "Light bulb", "idea tip"],
    ["📌", "pushpin", "Pushpin", "pin note"],
    ["📍", "round-pin", "Round pin", "location place"],
    ["🔔", "bell-emoji", "Bell", "notification subscribe"],
    ["📣", "megaphone", "Megaphone", "announce shout"],
    ["🎬", "clapper", "Clapper board", "film movie action"],
    ["🎵", "music-note", "Music note", "song"],
    ["🎧", "headphones", "Headphones", "music listen"],
    ["📸", "camera", "Camera with flash", "photo"],
    ["💻", "laptop", "Laptop", "computer work"],
    ["📱", "phone", "Mobile phone", "smartphone"],
    ["💰", "money-bag", "Money bag", "cash rich"],
    ["🛒", "cart", "Shopping cart", "shop buy"],
    ["⏰", "alarm", "Alarm clock", "time wake"],
    ["✅", "check-mark", "Check mark", "yes done"],
    ["❌", "cross-mark", "Cross mark", "no wrong"],
    ["⚠️", "warning", "Warning", "caution alert"],
    ["❓", "question-mark", "Question mark", "ask"],
    ["❗", "exclamation", "Exclamation mark", "important alert"],
    ["🚀", "rocket", "Rocket", "launch fast"],
  ]),
  ...emoji("Nature", [
    ["☀️", "sun", "Sun", "sunny weather summer"],
    ["🌈", "rainbow", "Rainbow", "pride weather"],
    ["🌙", "moon", "Crescent moon", "night"],
    ["☁️", "cloud", "Cloud", "weather"],
    ["❄️", "snowflake", "Snowflake", "winter cold"],
    ["🌸", "blossom", "Cherry blossom", "flower spring"],
    ["🌻", "sunflower", "Sunflower", "flower summer"],
    ["🍀", "clover", "Four leaf clover", "luck"],
    ["🌊", "ocean-wave", "Water wave", "ocean sea beach"],
    ["🍕", "pizza", "Pizza", "food"],
    ["☕", "coffee", "Hot beverage", "coffee tea"],
    ["🍿", "popcorn", "Popcorn", "movie snack"],
    ["🐶", "dog", "Dog face", "pet puppy"],
    ["🐱", "cat", "Cat face", "pet kitten"],
    ["✈️", "airplane", "Airplane", "travel flight"],
    ["🌍", "globe", "Globe", "earth world travel"],
  ]),
];

export const STICKER_INDEX = new Map(STICKERS.map((s) => [s.id, s]));

/** Look a sticker up the way an agent might name it: by id, label or the
 * emoji itself. */
export function findSticker(name: string): StickerDef | undefined {
  const n = name.trim();
  const lower = n.toLowerCase();
  return STICKER_INDEX.get(lower) ?? STICKERS.find((s) => s.label.toLowerCase() === lower || s.emoji === n);
}

/** Every word in `query` must appear in the sticker's label, tags,
 * category or id. Empty query lists the category (or everything). */
export function searchStickers(query: string, category?: StickerCategory | null): StickerDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return STICKERS.filter((s) => {
    if (category && !words.length && s.category !== category) return false;
    const hay = `${s.label} ${s.tags} ${s.category} ${s.id} ${s.text ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w) || s.emoji === w);
  });
}

// ---- placing one -----------------------------------------------------------------

/** Pixel size of a sticker's longer side when rendered for a project. */
export const STICKER_PX = 512;
/** Default footprint: 0.3 of a fit-to-canvas scale, about a third of the
 * frame's height for a square sticker in 16:9. */
export const STICKER_SCALE = 0.3;
export const STICKER_SECONDS = 3;

export interface StickerMotion {
  label: string;
  /** Entrance animation, 0.4 s. */
  in?: string;
  /** Loop animation and its period in seconds. */
  loop?: [string, number];
}

/** What a newly added sticker does. CapCut's stickers move by default; a
 * soft pop and float reads as alive without pulling the eye. */
export const STICKER_MOTIONS: Record<string, StickerMotion> = {
  still: { label: "Still" },
  pop: { label: "Pop in", in: "pop" },
  float: { label: "Pop + float", in: "pop", loop: ["float", 2] },
  pulse: { label: "Pop + pulse", in: "pop", loop: ["pulse", 1] },
  sway: { label: "Pop + sway", in: "pop", loop: ["sway", 1.6] },
  heartbeat: { label: "Heartbeat", in: "pop", loop: ["heartbeat", 1.2] },
};
export const DEFAULT_STICKER_MOTION = "float";

export const stickerFileName = (s: StickerDef) => `${s.label} sticker.png`;

/** The asset record for a rendered sticker file. */
export function stickerAsset(s: StickerDef, file: { src: string; size: number }, width: number, height: number, id: Id): Asset {
  return { id, kind: "image", name: stickerFileName(s), src: file.src, duration: 0, width, height, hasVideo: true, hasAudio: false, size: file.size, sticker: s.id };
}

/** Add the asset unless the project already has it. */
export const withAsset = (p: Project, a: Asset): Project => (p.assets.some((x) => x.id === a.id) ? p : { ...p, assets: [...p.assets, a] });

export interface StickerPlacement {
  start: number;
  /** Frames; default STICKER_SECONDS. */
  duration?: number;
  motion?: string;
  x?: number;
  y?: number;
  scale?: number;
}

/** Put a sticker's image on the timeline above everything at that time,
 * adding its asset if this project does not have it yet. */
export function addStickerClip(p: Project, asset: Asset, at: StickerPlacement): { project: Project; clipId: Id } {
  const base = clipForAsset(asset, at.start, p.fps) as ImageClip;
  const motion = STICKER_MOTIONS[at.motion ?? DEFAULT_STICKER_MOTION] ?? STICKER_MOTIONS.still;
  const clip: ImageClip = {
    ...base,
    duration: Math.max(1, at.duration ?? secondsToFrames(STICKER_SECONDS, p.fps)),
    transform: { ...base.transform, x: at.x ?? 0, y: at.y ?? 0, scale: at.scale ?? STICKER_SCALE },
    ...(motion.in ? { animIn: { type: motion.in, duration: secondsToFrames(0.4, p.fps) } } : {}),
    ...(motion.loop ? { animLoop: { type: motion.loop[0], duration: secondsToFrames(motion.loop[1], p.fps) } } : {}),
  };
  return { project: placeOnTop(withAsset(p, asset), clip, "Sticker"), clipId: clip.id };
}
