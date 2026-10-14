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
| Clip `in` (source offset) | seconds into the source file |
| `transform.x` / `.y` | fraction of canvas width/height from center (0 = centered; y grows downward) |
| `transform.scale` | 1 = fit inside the canvas |
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
Project { schema: 1, id, name, width, height, fps, sampleRate, background,
          assets: Asset[], tracks: Track[], markers: Marker[], luts?: LutFile[] }
Asset   { id, kind: video|audio|image, name, src, proxy?, duration,
          width?, height?, fps?, hasVideo, hasAudio, rotation? }
LutFile { id, name, src, kind: 1d|3d, size }   (the .cube stays in its file)
Track   { id, kind: video|audio, name, main?, clips: Clip[],
          muted, hidden, locked, volume }
Clip    = video | audio | image | text | color | adjustment   (see types.ts)
```

Rules `normalizeProject` enforces: clips on a track are sorted and never
overlap; audio clips only on audio tracks and nothing else on them; every
`assetId` exists; exactly one video track is `main` (the bottom one if
none is marked). Tracks are listed top to bottom; the top video track draws
last.

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

`ease` shapes the curve leaving that keyframe: `linear`, `hold`, `easeIn`,
`easeOut`, `easeInOut`, or a CSS-style bezier `[x1, y1, x2, y2]`.

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
