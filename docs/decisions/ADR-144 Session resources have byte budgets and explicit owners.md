# ADR-144: Session resources have byte budgets and explicit owners

- **Date**: 2026-10-21, **Status**: accepted

## Context
The lead measured WebView2 at 2.08 GB fresh and 5.47 GB after importing a
45-minute 1080p VOD and find_highlights (2026-10-22): +3.39 GB; create_clips
added 0.2 GB. Earlier long sessions reached 14.6 GB, falling to 2.3 GB on
reload. Code inspection found retained media inputs (64 MiB caches each),
indefinite model workers, image/text/thumbnail maps and retained MCP media
answers. Highlight extraction already streamed PCM; its features contain
no raw sound. These findings do not attribute all 3.39 GB to one holder.

## Decision
- Register resource owners; projectWork ends their document session after
  aborting jobs. Clear caches/undo, close inputs, release GPU targets and
  stop workers, including when reopening the same project ID.
- Byte LRU budgets (MiB): filmstrips 64, peaks 16, posters 8; compound
  strips 32/peaks 8; text 32, library previews 32, images 128, loops 256;
  highlight/music features 8 each, saliency 32, reverb impulses 16.
  Borrowers pin images across eviction until their render/copy finishes.
- Source read caches reserve 8 MiB each; retain at most 32 MiB of idle
  inputs, pinning active decoders. Keep ADR-074's 512 MiB preroll admission.
  Close discarded reverse prefetches. Reuse analysis/thumbnail canvases.
- Hear long sources in <=62-second overlapping windows; keep words only.
  One worker per model kind; terminate before another size and after two
  idle minutes. Never expire an active inference lease.
- Retain <=32 MiB/128 MCP job answers; discard media payloads on delivery.
  Raw render/still URLs need a caller fetch: releaseUrl, 60-second expiry,
  128 MiB LRU and session cleanup cover them. Memory exports cap at 128 MiB.
- memory() reports known bytes/budgets and labels native/model estimates.

## Consequences
Evicted work regenerates; model downloads remain cached on disk. No new
dependency or persisted field. The memory-long-media drive records
before/after JS heap (<=64 MiB growth) and closed known resources (<=8 MiB).
The lead reports memory-long-media passes in headless Edge. Desktop process
numbers still await the lead: this sandbox cannot launch browsers.
GPU/runtime scratch and decoder queues require the
real 45-minute desktop repeat; JS heap alone cannot validate WebView2 RSS.

## Switch and animation follow-up, 2026-10-22

Input-cache eviction originally disposed even borrowed inputs. Retire an
entry from the reusable cache on session end or relink, and dispose only
after its last borrower returns; count retired active inputs until then.
Tests cover two borrowers of one VOD, reopening that source in another
session, and a proxy source still opening when its session ends.

The animated-images drive still called the removed `imageFor` API. It now
uses `borrowImage` with `finally` release and checks viewer and exported
motion/looping for GIF, WebP and APNG individually. It also evicts a borrowed
loop and checks that removing the clip releases it. Engine tests exercise
the same plan-removal path for all three formats with a fake decoder.

The create-clips failure was the save before the switch, not the media.
Opening a project ends the last one's session, and releasing the compositor's
targets set its size to 0; the next save read the viewer for the Home card's
thumbnail, got the canvas size with no pixels, and `new ImageData` threw, so
the save failed and `open_project` answered false. Before this ADR the same
read returned the previous project's last frame, a thumbnail of the wrong
project. `player.pixels()` now answers null when nothing has been drawn since
the release, and the card keeps no thumbnail until the next save after a
frame. Thumbnail jobs canceled by a session end dispose their own input;
mediabunny reports that as `InputDisposedError`, now treated like an abort
instead of a warning.

Checked by the lead in headless Edge: create-clips, animated-images,
project-lifecycle, home-cards, home-menus, memory-long-media, clip-template
and the 21 other drives of the first run pass; vitest 226 files, 1,933 tests.
