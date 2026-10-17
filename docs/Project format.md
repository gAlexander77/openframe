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
| `transform.scale` | 1 = fit inside the canvas; the horizontal scale when `scaleY` is present |
| `transform.anchorX` / `.anchorY` | optional anchor point, shares of the picture's width/height from its center (absent = center); the position places it, scale and rotation turn about it |
| `transform.scaleY` | optional vertical scale (CapCut's Uniform scale off); absent = uniform. Older readers ignore it and draw the picture uniform |
| `opacity`, `volume` | 0..1 and linear gain (1 = 0 dB, up to 4 = +12 dB) |
| `adjust.*` | -100..100 (one-sided ones 0..100), including the grade's `hsl` and `wheels` |
| `adjust.lut.intensity`, `filter.intensity` | 0..1 |
| `adjust.curves.*` points | `[input, output]`, both 0..1 |

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
Project { schema: 1, id, name, width, height, canvasFixed?, fps, sampleRate, background,
          assets: Asset[], mediaFolders?: string[], tracks: Track[], markers: Marker[], luts?: LutFile[],
          compounds?: Compound[] }
Asset   { id, kind: video|audio|image, name, src, proxy?, duration,
          width?, height?, fps?, hasVideo, hasAudio, rotation?,
          sticker?, folder?, favorite? }   (sticker: the library sticker an image was drawn from)
LutFile { id, name, src, kind: 1d|3d, size }   (the .cube stays in its file)
Track   { id, kind: video|audio, name, main?, clips: Clip[],
          muted, hidden, locked, volume, pan? (-1..1, added to each clip's),
          solo?, height?: small|large }
Compound { id, name, tracks: Track[], markers: Marker[] }   (a nested timeline)
Clip    = video | audio | image | text | color | adjustment | compound   (see types.ts)
          every clip may carry group?: a shared id that selects and moves together
          every clip may carry labelColor?: red | orange | yellow | green | cyan
            | blue | purple | pink (a timeline color label)
          video and audio clips may carry eq?: { low?, mid?, high? } (dB)
          text clips may carry wordTimes?: number[] (frames from the clip's start
            each word is spoken) and style.highlight?: color of the spoken word
          video clips may carry stabilize?: { level, from, rate, x[], y[], zoom }
            (per-source-frame moves onto the smooth path; src/lib/analysis/stabilize.ts)
```

Rules `normalizeProject` enforces: clips on a track are sorted and never
overlap; audio clips only on audio tracks and nothing else on them; every
`assetId` exists; exactly one video track is `main` (the bottom one if
none is marked). Tracks are listed top to bottom; the top video track draws
last. The same rules hold inside every compound's `tracks`; every
`compoundId` exists, and no compound plays itself, even through others.

## Compound clips

A compound clip (CapCut's Create compound clip, Premiere's nested sequence)
plays a nested timeline from `compounds` the way a video clip plays a file
([[ADR-037 Compound clips are nested timelines composited to a texture]]):

```json
"tracks": [{ "kind": "video", "main": true, "clips": [
  { "type": "compound", "compoundId": "k1", "start": 60, "duration": 90, "in": 0.5, "speed": 1,
    "opacity": 0.8, "volume": 1, "pan": 0, "fadeIn": 0, "fadeOut": 0, "muted": false } ] }],
"compounds": [{ "id": "k1", "name": "Intro", "markers": [], "tracks": [
  { "kind": "video", "main": true, "clips": [ { "type": "video", "assetId": "a1", "start": 0, "duration": 150, "in": 4 } ] },
  { "kind": "audio", "clips": [ { "type": "audio", "assetId": "a2", "start": 0, "duration": 150, "in": 0 } ] } ] }]
```

- `in` is seconds into the nested timeline and `speed` its rate, so the
  clip above shows the compound's frames 15 to 104. Frames past the nested
  timeline's end show nothing.
- A compound clip has every visual and sound setting a video clip has
  (transform, crop, opacity, blend, adjust, effects, mask, key, animations,
  transitions, volume, pan, fades). They apply to the nested timeline's
  composited picture and mix.
- Speed curves, `reverse` and `freeze` are not supported on compound clips
  yet; they are dropped when a project is opened.
- Compounds share the project's frame rate and canvas; their frames,
  keyframes and markers are their own timeline's. A compound may hold
  compound clips of other compounds, never of itself.
- Several compound clips may play one compound: editing it changes them
  all. A compound nothing plays is dropped when the editor saves an edit.
- Absent `compounds` means none, so projects from before compound clips
  open unchanged.

## Media organization

Media folders are flat virtual names (1–80 trimmed characters), independent
of disk paths. Missing `mediaFolders` means none; missing asset `folder` means
Unfiled and missing `favorite` means false. Normalization merges case-insensitive
folder duplicates, recovers referenced folders and discards invalid favorites.
These optional schema-1 fields do not change rendering. Older builds can read
the edits but may discard folder definitions on saving (ADR-042).

## Color grading

A visual or adjustment clip's `adjust` holds the Basic sliders and,
optionally, the pro grade ([[ADR-020 The grade lives in adjust, in
Lumetri's order]]). Every part may be left out; left out means unchanged.

```json
"adjust": {
  "exposure": 0, "contrast": 10,
  "hsl": { "red": { "hue": 0, "saturation": -40, "lightness": 0 } },
  "curves": { "luma": [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]] },
  "wheels": { "lift": { "r": -3, "g": 1, "b": 6, "y": 0 }, "gain": { "r": 0, "g": 0, "b": 0, "y": 8 } },
  "lut": { "id": "lut_1", "intensity": 0.8 }
}
```

- `hsl` bands: `red orange yellow green cyan blue purple magenta`, each
  `{ hue, saturation, lightness }`.
- `curves` channels: `luma` (applies to R, G and B alike), `r`, `g`, `b`;
  points are interpolated with a monotone cubic and held flat past the
  first and last point.
- `wheels`: `lift`, `gamma`, `gain`, `offset`, each `{ r, g, b, y }` —
  r/g/b the color balance, y the luminance ring.
- `lut.id` must name an entry of the project's `luts`. LUT files are not
  embedded: `src` points at the .cube the way `Asset.src` points at media.

## Animating anything

Any numeric parameter can hold keyframes by path:

```json
"keyframes": {
  "transform.scale": [{ "f": 0, "v": 1 }, { "f": 60, "v": 1.2, "ease": "easeInOut" }],
  "effects.fx_ab12.amount": [{ "f": 0, "v": 0 }, { "f": 30, "v": 80 }],
  "adjust.wheels.gain.y": [{ "f": 0, "v": 0 }, { "f": 45, "v": 12 }]
}
```

Mask numbers animate the same way (`mask.x`, `mask.y`, `mask.width`,
`mask.height`, `mask.rotation`, `mask.feather`, `mask.radius`), as CapCut
keys every mask parameter; crop edges do not.

## Crop and masks

```json
"crop": { "left": 0.25, "top": 0, "right": 0.25, "bottom": 0.1 },
"mask": { "shape": "rectangle", "x": 0, "y": -0.1, "width": 0.5, "height": 0.4,
          "rotation": 15, "feather": 0.05, "invert": false, "radius": 0.3 }
```

- `crop` trims fractions of the **source** from each edge, before flips,
  scale and rotation; the part kept stays where the uncropped picture
  showed it, mirrored with a flip
  ([[ADR-048 Crop is cut from the source and edited on a copy]]). Each
  pair leaves at least 5% (`set_crop`).
- `mask.shape` is `linear`, `mirror`, `circle`, `rectangle`, `heart` or
  `star`. `x`/`y` move its center from the visible (cropped) picture's
  center and `width`/`height` size it, as fractions of that picture's
  width and height; `rotation` turns it rigidly, in degrees clockwise;
  `feather` 0..1 softens it; `invert` keeps the outside. Linear keeps what
  is above its line and ignores the size; mirror keeps a band `height`
  tall.
- `radius` is optional and only for `rectangle`: 0 (or absent) square, 1
  rounds each corner by half the shorter side. `heart`, `star` and
  `radius` came later and are additive: older files load unchanged, and
  older readers draw no mask for the new shapes
  ([[ADR-049 Masks turn rigidly and grow shapes without new fields]]).

`ease` shapes the curve leaving that keyframe: `linear`, `hold`, `easeIn`,
`easeOut`, `easeInOut`, or a CSS-style bezier `[x1, y1, x2, y2]`. A missing
`ease` is linear. The editor's other presets (Smooth, Fast in, Overshoot,
Anticipate) and hand-dragged curves are stored as beziers, so anything that
evaluates CSS `cubic-bezier()` reproduces them. A path never holds two keys
on one frame. Commands: `add_keyframe`, `move_keyframe`,
`set_keyframe_ease`, `remove_keyframes`.

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

## Remove BG

A video clip whose background was removed (CapCut's Video > Remove BG >
Auto removal) carries a reference to its matte
([[ADR-033 Mattes are made once and stored as grayscale video]]):

```json
{ "type": "video", "assetId": "a1", "start": 0, "duration": 180, "in": 0,
  "cutout": { "enabled": true, "src": "934da601-matte-talk.mp4", "from": 0, "to": 6,
              "model": "onnx-community/ormbg-ONNX" } }
```

- `src` is a grayscale video (luma = alpha) stored like imported media: an
  OPFS key on the web, an app-data path on desktop. It is not embedded.
- `from`/`to` are the source seconds the matte covers; matte time 0 is
  source time `from`. Frames outside it play with their background.
- `enabled: false` keeps the matte for an instant On again.
- `model` names the model that made it (a Hugging Face id), for the record.
- Absent means no background removal. `normalizeProject` drops a broken
  reference (no `src`, `to` not after `from`), and on any clip that is not
  video. Files without it load unchanged. Making a matte needs the app
  (`remove_background` over MCP, `window.videoEditor.ai.removeBackground`);
  `set_background_removal` turns an existing one off and on.

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
