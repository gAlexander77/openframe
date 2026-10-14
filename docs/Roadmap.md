# Roadmap

In rough priority order. The research notes' P0/P1 lists are the source;
items move to [[Features]] when they ship.

## In flight (parallel worktrees)

- **Color** — LUTs (.cube), HSL, curves, color wheels, scopes.
- **Keyframe graph editor** with easing curves, draggable diamonds.
- **Stickers and text templates** with engine-rendered previews.
- **Speed curves**, reverse, pitch preservation.
- **UX audit** of the running editor against CapCut.

## Next

- **Pro trim monitor**: the two-up view while rolling/slipping (the trim
  tools themselves shipped).
- **Inline text editing** on the canvas.
- **Proxies on the web** via mediabunny `Conversion` (short-GOP 720p).
- **Auto ducking**: music dips under speech as editable volume keyframes.

## Later

- Auto reframe (face tracking), background removal, speech cleanup
  (DeepFilterNet), offline TTS; true-peak limiting for broadcast.
- Opt-in generative providers (Seedance, Veo, Runway...) behind one
  plugin contract; never required.
- Multicam, compound clips/nesting, OTIO and FCP7 XML interchange.
- HDR via WebGPU.
