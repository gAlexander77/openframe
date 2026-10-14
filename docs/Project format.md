# Project format

The project file is plain JSON — open on purpose, the opposite of CapCut's
increasingly obfuscated drafts ([[CapCut desktop]] §2.14). People save it
through the app; agents and pipelines can write it directly or build it
with commands. The TypeScript source of truth is `src/lib/project/types.ts`;
`normalizeProject` (`src/lib/project/defaults.ts`) is the gate every file
passes through, filling defaults and rejecting what cannot be repaired.

## Units

| Quantity | Unit |
|---|---|
| Clip `start`, `duration`, keyframe `f`, marker `frame`, fades, animation and transition durations | **integer frames** at the project rate ([[ADR-004 Timeline time is integer frames]]) |
| `fps` | rational `{ "num": 30000, "den": 1001 }` (a bare number is accepted on input) |
| Clip `in` (source offset) | seconds into the source file where playback begins |
| `speed`, `speedCurve.points[].speed` | playback rate, 1 = normal (curves 0.1..10) |
| `speedCurve.points[].f` | frames from the clip's start, fractional allowed |
| `transform.x` / `.y` | fraction of canvas width/height from center (0 = centered; y grows downward) |
| `transform.scale` | 1 = fit inside the canvas |
| `opacity`, `volume` | 0..1 and linear gain (1 = 0 dB, up to 4 = +12 dB) |
| `adjust.*` | -100..100 (one-sided ones 0..100) |

## The smallest valid project

Everything not given gets its default. This is a complete file:

```json
{
  "fps": 30,
  "assets": [{ "id": "a1", "src": "C:/media/interview.mp4", "duration": 42.5 }],
  "tracks": [
    { "kind": "video", "clips": [
      { "type": "video", "assetId": "a1", "start": 0, "duration": 300, "in": 4 },
      { "type": "video", "assetId": "a1", "start": 300, "duration": 150, "in": 20.5 }
    ]},
    { "kind": "video", "clips": [
      { "type": "text", "text": "Chapter one", "start": 30, "duration": 90,
        "transform": { "y": 0.3 }, "animIn": { "type": "rise", "duration": 15 } }
    ]}
  ]
}
```

## Shape

```
Project { schema: 1, id, name, width, height, fps, sampleRate, background,
          assets: Asset[], tracks: Track[], markers: Marker[] }
Asset   { id, kind: video|audio|image, name, src, proxy?, duration,
          width?, height?, fps?, hasVideo, hasAudio, rotation? }
Track   { id, kind: video|audio, name, main?, clips: Clip[],
          muted, hidden, locked, volume }
Clip    = video | audio | image | text | color | adjustment   (see types.ts)
```

Rules `normalizeProject` enforces: clips on a track are sorted and never
overlap; audio clips only on audio tracks and nothing else on them; every
`assetId` exists; exactly one video track is `main` (the bottom one if
none is marked). Tracks are listed top to bottom; the top video track draws
last.

## Animating anything

Any numeric parameter can hold keyframes by path:

```json
"keyframes": {
  "transform.scale": [{ "f": 0, "v": 1 }, { "f": 60, "v": 1.2, "ease": "easeInOut" }],
  "effects.fx_ab12.amount": [{ "f": 0, "v": 0 }, { "f": 30, "v": 80 }]
}
```

`ease` shapes the curve leaving that keyframe: `linear`, `hold`, `easeIn`,
`easeOut`, `easeInOut`, or a CSS-style bezier `[x1, y1, x2, y2]`.

## Speed, ramps and reverse

Video and audio clips play their source at `speed` (0.5 = slow motion; the
clip is as long as its source span divided by the speed). A `speedCurve`
replaces that with a rate that varies, CapCut's Curve speed
([[ADR-027 Speed curves are exponential and anchored to clip frames]]):

```json
{ "type": "video", "assetId": "a1", "start": 0, "duration": 59, "in": 2, "speed": 1,
  "speedCurve": { "preset": "montage", "points": [
    { "f": 0, "speed": 0.8 }, { "f": 14.75, "speed": 3 }, { "f": 29.5, "speed": 0.5 },
    { "f": 44.25, "speed": 3 }, { "f": 59, "speed": 0.8 } ] } }
```

- The source time at clip frame `r` is `in` plus `∫₀ʳ speed` frames of the
  project rate, in seconds. Between points the rate changes exponentially — a straight
  line on a log axis — and it holds before the first and after the last.
- Points are anchored to the clip like keyframes: trimming leaves them in
  place (they may lie outside the clip), so the frames that stay keep their
  picture.
- `reverse: true` plays backward from `in`, which is then the *latest*
  source time read.
- `changePitch: true` lets the pitch follow the speed (CapCut's Change
  pitch); absent, the pitch is kept at any speed.
- `preset` names the tile it came from (`custom`, `montage`, `hero`,
  `bullet`, `jumpCut`, `flashIn`, `flashOut`); it does not change playback.

## Catalog names

Effects, transitions, filters and animations are referenced by name; the
lists live in `src/lib/catalog.ts` (e.g. effects `blur`, `glitch`, `vhs`;
transitions `dissolve`, `wipeLeft`, `zoomIn`; filters `teal`, `noir`;
animations `fade`, `pop`, `slideUp`, and loops `pulse`, `shake`).

## Building one with commands instead

Agents usually find commands easier than raw JSON: seconds instead of
frames, every argument validated with a readable error. See the registry in
`src/lib/commands.ts` and `window.videoEditor.commands()` for the live list
with JSON Schemas ([[ADR-006 Every edit is a named command with a JSON Schema]]).
