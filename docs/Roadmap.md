# Roadmap

In rough priority order. The research notes' P0/P1 lists are the source;
items move to [[Features]] when they ship. [[Feature gaps 2026-10-16]]
holds the full comparison with CapCut, Premiere, Resolve, VEGAS and Final
Cut, and marks what has shipped from its build order.

## In flight (parallel worktrees)

None.

## Next

- **Desktop check of the 2026-10-16 features**: everything from the CapCut
  parity pass was verified in the web build only. In the desktop app,
  check above all the microphone permission (voiceover), WebGPU model
  loading (background removal, text to speech) and installed fonts (Local
  Font Access in WebView2).
- **OpenFrame rename and open-source preparation**: follow [[Next agent handoff]],
  [[Renaming]] and [[Release preparation]]. The name and GPL-3.0-only license
  are chosen; runtime identity, migration and release metadata are pending.
  Keep the repository private.
- **Desktop-first delivery, browser validation second**: the owner reaffirmed
  desktop priority on 2026-10-14. Retain ADR-003 and the existing shared core;
  log browser import/persistence/export/codec/model capability checks with
  revision and platform evidence before promising web parity.
- **From the survey's "next after these"**: rate stretch tool,
  insert/overwrite and lift/extract keys, a LUFS meter, preferences,
  picture border and shadow, frame blending, EQ, auto color, proxies on
  demand, keyboard focus for clips.
- **Proxies on the web** via mediabunny `Conversion` (short-GOP 720p).

## Later

- Auto reframe (face tracking), motion tracking, transcript editing,
  filler-word removal (needs a recognizer that keeps fillers: Whisper
  drops most), learned noise reduction (DeepFilterNet); true-peak
  limiting for broadcast.
- Rotation and zoom in stabilization (translation only today).
- Opt-in generative providers (Seedance, Veo, Runway...) behind one
  plugin contract; never required.
- Multicam, FCP7 XML interchange.
- HDR via WebGPU.
