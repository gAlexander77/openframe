# ADR-143: Clip templates repair their checks and imports classify audio conservatively

**Date:** 2026-10-21. **Status:** accepted.

## Context

Fresh stream clips covered faces and app controls and failed their own
contrast and reading checks. An imported speech WAV became a music stem.

## Decision

`create_clips` uses the checker's letter boxes and the ad safe area. Stream
hooks stay below the facecam; full-frame hooks clear sampled saliency
subjects within the clip's framed region. Without a subject, use a boxed
upper third. Omit and report a hook when no clear room exists. Text carries
opaque contrast protection. Captions default to two words, borrowing pauses
and merging when necessary; no recognized words are discarded. Card holds
grow with their copy. Run the measured social-short check before saving,
repair low contrast, and return every remaining finding with its fix.

Audio imports without an origin use up to 60 seconds of 20 ms mono energy
windows. Irregular syllable modulation and pauses suggest dialog; sustained
or periodic energy suggests music. Ambiguous results remain unset, including
track placement. Existing explicit roles and legacy tool names still win.
The import answer and toast explain the result; no new persisted field or
model dependency is introduced.

## Consequences

Clip creation renders check frames before saving. Extreme splits, excessive
copy and infeasible speech rates return findings rather than a false pass.
Saliency is a subject estimate; a person still reviews framing and ASR.
Energy cannot reliably distinguish singing or speech over music; users can
override track roles. Browser drives do not establish desktop parity.

### 2026-10-22: placement order and drive correction

The stream drive opened the saved clip correctly (ADR-141), but its hook
was disabled with `hook_no_clear_room`. Placement counted the initial boxes
of text still waiting to be placed: a wrapped credit moved away from the
unplaced hook and captions, occupying the hook's available band. Each part
now avoids only already placed text; subsequent parts clear it in turn.
The regression models wrapping and box padding with opening credit and
captions, and requires an enabled, nonoverlapping hook in all three layouts.

The drive verifies the returned project ID after `open_project`, requires
a visible hook inside the safe area in every layout, checks stream hooks
below the facecam, and checks full-frame hooks against sampled subjects
(or an explicitly reported fallback). Missing/disabled hooks and overlapping
opening text fail; the former non-stream geometry check passed unconditionally.
