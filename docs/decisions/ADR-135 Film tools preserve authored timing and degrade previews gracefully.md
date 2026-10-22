# ADR-135 Film tools preserve authored timing and degrade previews gracefully

Date: 2026-10-21
Status: accepted

## Context

Two blind film tests met an unplayable MP3 preview, confusing time units,
wrapped end-card lines, truncated score grids, false SFX splice warnings,
and adaptations that treated texture as a subject or kept uneven fades.

## Decision

Register LAME before probing MP3 and prebundle the encoder extensions with
one deduplicated Mediabunny. Preview MP3 falls back to AAC/M4A then 16-bit
24 kHz mono WAV, and reports the actual format; explicit formats are allowed.
Keep fractional check_at and add mutually exclusive master-second check_times,
mapped through the same opening/end-card cut as versions. Report placed
voice clip bounds, preserving speech seconds. Explicit headline lines fit
the widest line before wrapping, above the readable floor and room rules.
An explicit montage end is a final boundary. Supplied music grids keep quiet
beats, and marker additions exclude removals. Complete generated SFX meeting
at their endpoints are events, not splices; trimmed sounds remain checked.
Held duck pauses are optional validated source-second intervals, mapped to
the measured window for concrete range advice. Diffuse/repeating saliency
without a dominant component centers the crop and says why. Adapted title
fades use the checker's measurements and replace an uneven fade with a cut,
naming the change. The master remains untouched.

## Consequences

Preview remains playable without a device encoder. Old projects need no
migration; older ducks lack pause counts until ducked again. Center fallback
is conservative saliency, not semantic subject recognition; explicit focus
wins. Version preparation renders title checks and therefore takes longer.
Source-inventory prose is not authoritative media timing; a small duration
difference alone does not justify changing decoder metadata.
