# ADR-025: Stickers and templates are ordinary clips

- **Date**: 2026-10-14 · **Status**: accepted

## Context

CapCut's Stickers tab streams thousands of animated stickers from its
cloud and keeps them as their own segment type ([[CapCut desktop]] §1.4,
§3.11). We have no server and want none ([[ADR-003 Desktop first, one
build, a platform seam]]); the project file must stay open, plain JSON
([[Project format]]) that renders the same anywhere.

## Decision

- **A sticker is an image clip.** The library (`src/lib/stickers.ts`) is
  emoji drawn from the system's color emoji font plus graphics drawn in
  code (`src/engine/stickers.ts`: arrows, marker circles, bubbles, bursts,
  neutral badges). Adding one renders a 512 px PNG trimmed to its ink,
  hands it to `platform.adoptFiles` like any dropped file, and places an
  image clip — asset and clip in one undo step.
- **Rendered once, then a file.** The asset remembers its sticker
  (`Asset.sticker`), so adding it again in that project reuses the asset;
  the adopted file is reused for the session. A project opened on a
  machine with a different emoji font still shows the art it was made
  with, and export, thumbnails and agents see a normal image.
- **On top, at a third of the frame.** `placeOnTop` (`src/lib/overlays.ts`)
  puts a new overlay directly above the topmost track busy at that time,
  reusing a free overlay row; scale 0.3 of fit; a pop-in plus a gentle
  loop by default, chosen per viewer in the tab.
- **Agents** call `add_sticker`. Drawing the PNG needs the engine, so,
  per [[ADR-006 Every edit is a named command with a JSON Schema]], the
  registry's command only places a sticker whose asset exists and says so
  otherwise; `window.videoEditor.exec` draws the asset first and runs the
  command with it in the same undo step.
- **Not a virtual source.** A `sticker:` URL drawn on demand would avoid
  the file but put a second kind of source into decode, thumbnails,
  export and the desktop's Rust side, and tie a project's look to fonts.

## Consequences

No new clip type, schema version or renderer path: stickers get the
inspector's transform, blend, masks and animations for free. The sticker
set is small (about 140) and static; `ponytail:` animated stickers would
need an image-sequence or video source, the upgrade path being a rendered
WebM through the same adopt path. Each first use writes a small PNG into
the platform's media store.
