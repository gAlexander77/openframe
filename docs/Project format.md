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
          compounds?: Compound[], brand?: Brand }
Brand   { name?, colors: { primary, secondary, accent, background, text },
          fonts: { heading, body }, logos?: { main?, light?, dark?, icon? } (image asset ids),
          url?, tagline? }   (set_brand; a logo whose asset is gone is dropped on load)
Asset   { id, kind: video|audio|image, name, src, proxy?, duration,
          width?, height?, fps?, hasVideo, hasAudio, rotation?,
          sticker?, folder?, favorite?, speech?, role?, sound?, musicGrid? }   (sticker: the library sticker an image was drawn from;
          role: dialog|music|effects|ambience, what a file the app made is;
          sound: { id, seed? }, the built-in effect or ambience bed it was made from;
          musicGrid: { bpm, firstDownbeat, sections?: [{ at, label }] }, a song's
          grid in its own seconds, given by set_music_grid or kept by
          generate_music; analysis reads the song through it: ADR-101)
Speech  { text, caption?, voice, speed, pronounce?: { word: respelling },
          quality?: best|draft, finish?: natural|clean|raw }
          (on a speech file the app read: the line as written, pause marks included;
          review_voiceover compares against it, retake_voiceover reads it again)
LutFile { id, name, src, kind: 1d|3d, size }   (the .cube stays in its file)
Track   { id, kind: video|audio, name, main?, clips: Clip[],
          muted, hidden, locked, volume, pan? (-1..1, added to each clip's),
          solo?, height?: small|large, role? }   (role, audio tracks only: dialog|music|effects|ambience,
          the stem it is; absent, it is judged by its clips' files: ADR-098)
Compound { id, name, tracks: Track[], markers: Marker[] }   (a nested timeline)
Marker  { id, frame, label, color, duration?: frames, chapter?: boolean, follows?: { clip, at } }   (follows: a song's beat,
          bar, part or drop on a video or audio clip, at that second of its file;
          the marker moves with the clip, through a compound clip that plays it
          once the clip is inside one, and goes when nothing plays it: ADR-101,
          ADR-106)
Clip    = video | audio | image | text | color | adjustment | compound   (see types.ts)
          every clip may carry group?: a shared id that selects and moves together
          every clip may carry labelColor?: red | orange | yellow | green | cyan
            | blue | purple | pink (a timeline color label)
          video and audio clips may carry eq?: { low?, mid?, high? } (dB)
          video and audio clips may carry fill?: left | right (one channel on both)
          video and audio clips may carry highpass?, lowpass?, echo?, reverb?,
            tapeStop? (sound design; see Sound design below)
          text clips may carry wordTimes?: number[] (frames from the clip's start
            each word is spoken) and style.highlight?: color of the spoken word
          text styles may carry case?: upper | lower | title (shown so; the
            text itself is kept as typed), stroke2?: { color, width } (a second
            outline), glow?: { color, blur, strength? }, gradient?: { from, to,
            angle } (fills instead of color), accent?: the color the
            highlightSweep and underlineWipe animations draw in, and
            weight?: 100..900 (wins over bold; absent: 700 bold, 400 not)
          animIn, animOut and animLoop may carry unit?: letter | word | line,
            stagger?: 0..1 and order?: forward | backward | center | random:
            on a text clip the animation then plays per unit (src/lib/kinetic.ts)
          video clips may carry stabilize?: { level, from, rate, x[], y[], zoom }
          video clips may carry frameBlend?: true (mix neighboring source frames)
            (per-source-frame moves onto the smooth path; src/lib/analysis/stabilize.ts)
          visual clips may carry trackMatte?, motionBlur?, edge?, wiggle?,
            shadow?, border? and color clips shape? (see Graphics)
```

Rules `normalizeProject` enforces: clips on a track are sorted and never
overlap; audio clips only on audio tracks and nothing else on them; every
`assetId` exists; exactly one video track is `main` (the bottom one if
none is marked). Tracks are listed top to bottom; the top video track draws
last. The same rules hold inside every compound's `tracks`; every
`compoundId` exists, and no compound plays itself, even through others.

## Sound design

Video and audio clips may carry these effects
([[ADR-060 Sound design rings past the clip and is measured as exported]]);
each absent means off, so older projects open unchanged:

```json
{ "type": "audio", "assetId": "a2", "start": 0, "duration": 300, "in": 0, "speed": 1,
  "lowpass": { "cutoff": 400, "resonance": 0 },
  "reverb": { "size": 0.9, "decay": 6, "mix": 0.4 },
  "echo": { "time": 0.3, "feedback": 0.5, "mix": 0.5 },
  "tapeStop": { "duration": 1.5 },
  "keyframes": { "lowpass.cutoff": [{ "f": 135, "v": 400 }, { "f": 150, "v": 20000 }] } }
```

- `highpass` / `lowpass`: `cutoff` in Hz (20..20000), `resonance` in dB
  (0..24); 24 dB per octave; `makeup?` in dB (-24..24, absent 0), a gain
  after the filter making up what it takes out (set_audio_filter
  keep_loudness, ADR-114). Keyframes on `lowpass.cutoff` and
  `highpass.cutoff` move on a log scale between keys.
- `reverb`: `size` 0..1, `decay` seconds to fall 60 dB (0.1..10), `mix`
  0..1 wet share at equal power (keyframeable as `reverb.mix`).
- `echo`: `time` seconds between repeats (0.01..2), `feedback` 0..0.9,
  `mix` 0..1 (keyframeable as `echo.mix`).
- `tapeStop`: `duration` seconds (0.05..10) over which the sound slows to
  a stop at the clip's end.
- The loader clamps each number into its range, fills a missing one with
  its default, and drops an effect that is not an object. Compound clips
  take none yet: they are dropped when a project is opened.

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

## Graphics

Shape layers, track mattes, motion blur, edges, wiggle, drop shadows and
borders are optional fields (ADR-056 to ADR-059, ADR-062, ADR-069, ADR-070,
ADR-099);
absent means off, so files without them load unchanged.

```json
{ "type": "color", "color": "#0f1218", "start": 60, "duration": 90,
  "transform": { "x": -0.22, "y": 0.3, "scale": 1, "rotation": 0, "flipX": false, "flipY": false },
  "shape": { "kind": "rectangle", "width": 0.36, "height": 0.12, "radius": 0.3,
             "stroke": { "color": "#ffcc00", "width": 4 }, "draw": 1 },
  "motionBlur": { "shutter": 180 },
  "shadow": { "color": "#000000", "blur": 60, "x": 0, "y": 24, "opacity": 0.5 },
  "border": { "color": "#ffffff", "width": 8, "opacity": 1 } },
{ "type": "color", "color": "#6a5cff", "start": 0, "duration": 240,
  "shape": { "kind": "ellipse", "width": 0.6, "height": 0.8, "feather": 120,
             "gradient": { "kind": "radial", "from": "#6a5cffcc", "to": "#6a5cff00", "angle": 0, "radius": 0.9 } } },
{ "type": "video", "assetId": "a1", "start": 0, "duration": 75, "in": 0,
  "trackMatte": { "clipId": "c_title", "mode": "alpha" },
  "edge": "mirror",
  "wiggle": { "x": { "frequency": 3, "amplitude": 0.0073, "seed": 12 },
              "rotation": { "frequency": 2, "amplitude": 0.6, "seed": 12, "strength": 0.5 } } }
```

- `shape` (color clips only; the clip's `color` is the fill):
  `kind` `rectangle`, `ellipse` or `line`; `width`/`height` fractions of the
  canvas (a line is `width` long, horizontal before rotation; its height is
  unused); `radius` 0..1 of half the shorter side (rectangles; 1 is a
  pill); `fill: false` for an outline only; `gradient: { from, to, angle }`
  replaces the fill color (degrees, 0 left to right, 90 top to bottom; a
  line's color too); with `kind: "radial"` it runs from `from` at the
  center to `to` at the rim, an ellipse fitting the box, `x` and `y`
  moving the center by fractions of the box from its middle (absent 0)
  and `radius` a fraction of its half size (absent 1, its sides); older
  builds draw a radial gradient as a linear one; `feather` pixels at 1080p
  of soft edge: the shape blurred by a Gaussian of sigma a quarter of it,
  so the edge falls off centered on the outline and a feather wider than
  the shape dims its middle (absent 0, crisp; older builds draw it crisp,
  and builds before ADR-099 as a Gaussian of the distance to the edge,
  which creased on wide feathers); `stroke: { color, width }` centered on the outline,
  width in pixels at 1080p (a line's thickness; 8 when absent); `draw` 0..1
  the share of the outline or line drawn (absent: all), from the top
  center clockwise or a line's left end. Colors are CSS: `#rgb`, `#rrggbb`,
  `#rrggbbaa`, `rgb()`, `rgba()` or a common name. Older builds draw such
  a clip as a full-canvas solid.
- `trackMatte: { clipId?, mode }`: `mode` `alpha`, `alphaInverted`,
  `luma` or `lumaInverted`; `clipId` a visual clip of the same timeline,
  absent for whatever is on the video track directly above at each frame.
  A named matte is never drawn; a track-above matte only while it cuts.
  `normalizeProject` drops a named matte whose clip is missing, is the clip
  itself, or has no picture.
- `motionBlur: { shutter }`: degrees, 1..720 (180 is After Effects' and
  film's). 0 or less is dropped.
- `edge`: `mirror` or `repeat`.
- `wiggle`: per value `x`, `y` (canvas fractions), `rotation` (degrees)
  or `scale` (scale factor), each `{ frequency (Hz), amplitude, seed,
  strength? (0..1, absent 1) }`.
- `shadow: { color, blur, x, y, opacity }` (any visual clip): a drop
  shadow cast by the finished picture. `blur` 0..600 is twice the
  Gaussian's sigma, `x` and `y` the fall (y down), all pixels at 1080p;
  `opacity` 0..1 multiplies the color's alpha. Missing numbers load as the
  defaults (60, 0, 24, 0.5), out-of-range ones clamped; anything that is
  not an object is dropped.
- `border: { color, width, opacity }` (any visual clip): a border drawn
  outside the finished picture's edge (its alpha after mask, crop,
  effects and matte), before its shadow. `width` 0..200 pixels at 1080p,
  whatever the clip's scale; `opacity` 0..1 multiplies the color's alpha
  and the clip's opacity. Missing numbers load as the defaults (8, 1),
  out-of-range ones clamped; anything that is not an object is dropped.
  Older builds draw no border.

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
keys every mask parameter; crop edges do not. So do a shape's
(`shape.width`, `shape.height`, `shape.radius`, `shape.stroke.width`,
`shape.draw`, `shape.feather`, `shape.gradient.angle`, `shape.gradient.x`,
`shape.gradient.y`, `shape.gradient.radius`), a drop shadow's
(`shadow.blur`, `shadow.x`, `shadow.y`, `shadow.opacity`), a border's
(`border.width`, `border.opacity`) and a wiggle's
(`wiggle.x.strength`, `wiggle.x.amplitude`, and the same for `y`,
`rotation` and `scale`). A picture's tilt keys as
`transform.rotateX`, `transform.rotateY` and `transform.perspective`:
degrees (CSS's rotateX and rotateY) and the camera's distance in pixels
at 1080p (absent 2000), all optional in `transform`; older builds draw the
picture flat. A title's `style.size` and `style.letterSpacing`
key as numbers; `style.color` keys hold the color as a 0xRRGGBB number
(`#ff3366` is 16724838) and move channel by channel; keyed colors are
opaque ([[ADR-071 Keyed title styles redraw the title]]). Older builds
draw such a title at its stored style.

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
`easeOut`, `easeInOut`, `spring`, `elastic`, `bounce` (overshoot and
settle, ADR-062), or a CSS-style bezier `[x1, y1, x2, y2]`. A missing
`ease` is linear, and so is a name a reader does not know. The editor's other presets (Smooth, Fast in, Overshoot,
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
animations `fade`, `pop`, `slideUp`, and loops `pulse`, `shake`; for
titles only, the kinetic `typewriter`, `letterRise`, `letterFade`,
`wordPop`, `wordRise`, `wordSlide`, `lineRise`, `highlightSweep` and
`underlineWipe`).

## Building one with commands instead

Agents usually find commands easier than raw JSON: seconds instead of
frames, every argument validated with a readable error. See the registry in
`src/lib/commands.ts` and `window.videoEditor.commands()` for the live list
with JSON Schemas ([[ADR-006 Every edit is a named command with a JSON Schema]]).

## Optional mixer and animated-image fields

`Project.masterVolume` is linear master gain (default 1). `Track.color` is
one of the clip-label palette names; a clip label overrides it. Track pan,
solo and height survive normalization. Display preferences are not project
fields. `Asset.animated` marks an ImageDecoder-backed image; `duration`
then contains one loop in seconds. The image clip can last longer and loop.
Collected JSON uses relative `src` and `proxy` paths beside the project file,
including LUTs and nested cutout media; opening it creates a fresh id.
`ImageClip.imageIn` optionally stores the animation phase in source seconds; trims and splits preserve it.

Marker `duration` is an optional nonnegative integer frame count; absent or
zero means a point. `chapter` is an optional boolean, absent meaning false.
Normalization drops invalid values at both root and compound boundaries.
Ranges follow their start when `follows` is present. Chapter-enabled MP4
exports include only explicit chapter markers; these fields do not change
rendered pictures or project duration. Edit-point selections are session
state and never enter the project file.
