# ADR-089 Mixer taps and timed images share the render engines

Status: implemented; desktop runtime validation pending.

Track gain and pan already live in the shared sound envelopes. Preserve
that math and route the clip outputs into separate left/right analysers per outer track,
then a master gain. This measures the sum after the track's gain and pan,
including compound audio, without changing the existing pan convention.
The same master gain is inserted for offline rendering. The mixer reads
peak/RMS blocks and the player's existing short-term loudness accumulator.
Range gestures use the existing one-undo-step helper.

Animated images stay image clips, with optional `Asset.animated` and a
one-loop duration. ImageDecoder frames are immediately copied to owned
ImageBitmaps and closed in a finally block; frame selection uses half-open
variable-duration intervals modulo the loop length. This keeps alpha and
shares preview/export behavior. The decoded loop cache has a 256 MiB limit
per image; streaming large loops is a future improvement. Without
ImageDecoder, the existing still-image path remains available.

Track colors are optional palette names. Timeline display choices are
profile preferences, separate from the project and undo history. Clip
labels override track colors. Project normalization preserves track pan,
solo, height and color, plus optional master gain.

