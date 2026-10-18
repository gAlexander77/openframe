# Roadmap

In rough priority order. The research notes' P0/P1 lists are the source;
items move to [[Features]] when they ship. [[Feature gaps 2026-10-16]]
holds the full comparison with CapCut, Premiere, Resolve, VEGAS and Final
Cut, and marks what has shipped from its build order.

## In flight (parallel worktrees)

None.

## Next

- **Desktop check of the 2026-10-16 features**: most of the CapCut parity
  pass was verified in the web build only. Text to speech, export and the
  MCP tools have since run in the desktop app (2026-10-17); still to check
  there: the microphone permission (voiceover), the camera and screen
  capture permissions (Record), WebGPU background removal and installed
  fonts (Local Font Access in WebView2).
- **A packaged release** when the owner asks: installer, signing, release
  notes ([[Release preparation]]). The rename is done and the source is
  public ([[Renaming]]); CI checks every pull request.
- **Desktop-first delivery, browser validation second**: the owner reaffirmed
  desktop priority on 2026-10-14. Retain ADR-003 and the existing shared core;
  log browser import/persistence/export/codec/model capability checks with
  revision and platform evidence before promising web parity.
- **Still open from the survey** ([[Feature gaps 2026-10-16]]): border and
  shadow on pictures (layer shader), a subject detector for auto reframe
  (a box picks it today),
  proxies on demand, translated captions (waits on a non-English speech
  fixture), a compressor on compound clips.
- **Proxies on the web** via mediabunny `Conversion` (short-GOP 720p).

## Later

- Learned noise reduction (DeepFilterNet); true-peak (oversampled)
  limiting for broadcast deliverables; a recognizer that keeps "uh" for
  filler removal.
- Rotation and zoom in stabilization (translation only today).
- Opt-in generative providers (Seedance, Veo, Runway...) behind one
  plugin contract; never required.
- Multicam, FCP7 XML interchange.
- HDR via WebGPU.
