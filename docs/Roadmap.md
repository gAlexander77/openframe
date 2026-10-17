# Roadmap

In rough priority order. The research notes' P0/P1 lists are the source;
items move to [[Features]] when they ship.

## In flight (parallel worktrees)


## Next

- **OpenFrame rename and open-source preparation**: follow [[Next agent handoff]],
  [[Renaming]] and [[Release preparation]]. The name and GPL-3.0-only license
  are chosen; runtime identity, migration and release metadata are pending.
  Keep the repository private and preserve paused agent work.
- **Desktop-first delivery, browser validation second**: the owner reaffirmed
  desktop priority on 2026-10-14. Retain ADR-003 and the existing shared core;
  log browser import/persistence/export/codec/model capability checks with
  revision and platform evidence before promising web parity. The process
  uncertainty and pickup plan are in [[Next agent handoff]].
- **Pro trim monitor**: the two-up view while rolling/slipping (the trim
  tools themselves shipped).
- **Proxies on the web** via mediabunny `Conversion` (short-GOP 720p).

## Later

- Auto reframe (face tracking), background removal, speech cleanup
  (DeepFilterNet), offline TTS; true-peak limiting for broadcast.
- Opt-in generative providers (Seedance, Veo, Runway...) behind one
  plugin contract; never required.
- Multicam, compound clips/nesting, OTIO and FCP7 XML interchange.
- HDR via WebGPU.
