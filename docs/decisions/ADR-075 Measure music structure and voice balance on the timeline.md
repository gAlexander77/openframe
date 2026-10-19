# ADR-075: Measure music structure and voice balance on the timeline

Status: accepted. Date: 2026-10-18.

Music analysis previously suppressed boundaries less than four bars apart,
losing a two-bar breakdown. Two-bar averaging also located a rising build's
boundary early. Use adjacent bars to locate sustained changes, retain the
two-bar evidence, and allow boundaries two bars apart. Smaller changes on
phrase lines can mark variations. Keep the biggest `drop` for compatibility
and add chronological `drops`; drop markers include every qualifying rise.
These remain heuristic labels on a constant-tempo 4/4 grid.

For loudness, render isolated stems through the same mixer as export,
preserving mute, solo, clip/track gain, fades and effects. Report integrated
and short-term loudness per audio track; combine dialog tracks before
measuring dialog and likewise for music. Stem measurements precede master
normalization even when the main report requests an export target.

Track names supply roles until the project has explicit stem metadata:
Voiceover tracks are dialog; other audio tracks except Sound effects/SFX
are music. The convention and measurement window are part of the tool's
contract. Music on a video track is not part of that automatic music group.

Targeted ducking measures the chosen music clip and audible voice clips
only while someone speaks: over the speech windows, joined across gaps
under a second, their energies averaged by length. (Until 2026-10-19 it
measured one first-to-last window, gaps included. The bed between lines,
where the dip releases, counted against the target, and a voiceover with
long gaps was pushed to the 40 dB limit, 38 LU under every line.) It starts from
unducked music, chooses attenuation in 0-40 dB, renders candidate volume
keys, and corrects the depth up to four times. It reports the achieved
balance and whether it is within 0.5 LU, including when a target cannot be
reached. No boost is applied. Only the final keys enter undo history; a
project change or cancellation during measurement prevents a stale edit.
Existing fixed-depth callers retain their behavior.

Validation: the known 56-second track now yields sections 0-4, 4-8, 8-24,
24-32, 32-36, 36-48 and 48-56 seconds; drops are 8 and 36 seconds, with
36 the biggest. The recorded speech and music fixtures measured voice
1.7 LU below music before ducking and 10.0 LU above after 11.67 dB of
attenuation; undo restored the original balance. Built-in add_voiceover
validation remains blocked in this environment by its model download.
