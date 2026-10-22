# ADR-137: Timeline interchange shares one import boundary

Date: 2026-10-21
Status: accepted

## Context

Editors exchange cuts in OTIO, FCPXML and CMX EDL. OpenFrame exported only
OTIO. A timeline import must preserve integer frame timing, missing media
and the project already open, without bringing DOM APIs into the core.

## Decision

- Parse OTIO directly; translate the supported FCPXML subset to OTIO-shaped
  data, then construct fresh objects and call `normalizeProject`. Retain
  only explicitly understood metadata; do not hydrate arbitrary clip JSON.
- OTIO transitions do not advance the track clock. FCPXML transitions
  occupy an interval, so export trims neighboring handles and import
  restores them. Connected offsets use their parent's source clock.
- Use native FCPXML media/sequence resources for compounds. Basic generated
  text/color travels in metadata on gaps; effects and retiming are reported.
- Read files and save through the platform seam. Import holds the existing
  navigation lock, saves the current project and persists a new identity.
  Unresolved media remains relinkable; the web resolves HTTP(S) URLs only.
- EDL is the main picture track plus separate audio lists, with explicit
  black gaps, stable eight-character reels and SMPTE drop-frame labels.

## Consequences

No dependency or document-schema change. Unit fixtures and a web drive
check structure, not native Final Cut/Resolve/Premiere interoperability;
that remains a separate validation step. Unsupported items appear in reports.
Schema references: [OTIO](https://opentimelineio.readthedocs.io/en/v0.15/api/python/opentimelineio.schema.html),
[FCPXML DTD](https://developer.apple.com/documentation/professional-video-applications/document-type-definition).
