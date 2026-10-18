# ADR-060: Sound design rings past the clip and is measured as exported

**Date:** 2026-10-18. **Status:** accepted.

## Context

Trailers, ads and "epic edits" are built on a handful of sound moves: the
music muffled under a build and opened on the drop (a low-pass sweep), a
voice in a big room, an echo trailing a hit, the track dying on a tape
stop. OpenFrame had an EQ and a compressor per clip and nothing for
time. Agents make these videos through MCP, so each move has to be a
command an LLM can call right the first time, with units and an example.

What the editors we imitate do: Premiere has Lowpass, Highpass, Studio
Reverb and Delay as clip effects, and their tails stop at the clip's end
(the long-standing complaint; the workaround is a track effect or a
longer clip). CapCut's voice effects are baked into the clip's length
too. A DAW puts reverb and delay after the fader, on an insert or a
send, so the tail rings on after the region ends. Export renders the mix
in 10 s OfflineAudioContext windows (ADR-014), and each window started
its graph from silence: a reverb would have been cut at every window
edge and started dry in the next.

## Decision

- **Five optional fields on a clip's sound** (`highpass`, `lowpass`,
  `echo`, `reverb`, `tapeStop`; `src/lib/soundFx.ts`), and **one command
  per effect** (`set_audio_filter`, `set_reverb`, `set_echo`,
  `set_tape_stop`). One `set_audio_effect` with a type would give an LLM
  one schema whose parameters change meaning with the type; four short
  schemas each name their units, ranges, defaults and an example, and
  share `off: true`.
- **The chain**: EQ, compressor, high-pass, low-pass, then the clip's
  volume (fades, keyframes), then echo, then reverb, then pan
  (`src/engine/soundFx.ts`, built inside the one `scheduleAudio` graph, so
  preview, export and measurement cannot drift). The filters are inserts
  before the fader; the time effects come after it, so their tails ring
  past the clip's end and its fade, as in a DAW and unlike Premiere.
- **Export windows pre-roll** (`src/engine/mixdown.ts`): each window
  renders from the longest effect tail earlier (reverb pre-delay plus
  decay, echo repeats to -60 dB, 50 ms of filter state; at most 12 s) and
  drops the pre-roll, so tails and filter state cross window edges. With
  no effects the pre-roll is 0 and a plain mix renders exactly as before.
- **Filters**: two biquads, 24 dB per octave (Linkwitz-Riley at
  resonance 0). Web Audio's low/high-pass `Q` is the resonance in dB, so
  the first stage takes -3.01 dB (Butterworth's 0.707) and the second
  `resonance - 3.01`. **Cutoff keyframes interpolate on a log scale**,
  the same octaves each second, as a filter knob turns: in Hz, a 300 to
  20000 sweep over 5 s would be past 10 kHz in half the time and sound
  open almost at once.
- **Reverb**: a ConvolverNode with an impulse response made from size,
  decay and mix: seeded noise (mulberry32, one seed per side), an
  exponential envelope falling 60 dB over `decay`, a pre-delay of 5 to 50
  ms and a build-up that grow with `size`, and a one-pole low-pass whose
  corner falls with time (highs die first) with its loss made up so the
  envelope holds. Scaled to unit energy per side with the browser's
  normalization off, and mixed wet and dry at equal power, so adding a
  reverb leaves the clip about as loud. Responses are cached per room.
- **Echo**: a DelayNode with a feedback gain (at most 0.9) in a loop,
  mixed at equal power.
- **Tape stop** is made by the engine's retimer (ADR-028), not a
  playbackRate ramp: chunks scheduled at a constant rate cannot follow a
  changing one. Over the clip's last `duration` seconds the speed falls
  linearly to 0 (a turntable coasting), the clip's own time map read at
  the warped time `u - (u - s)^2 / 2n`, through varispeed so the pitch
  falls with it, and the level follows the speed below half speed, so it
  ends without a click. A plain clip plays as before up to the stop and
  only the stop goes through the retimer; a pitch-kept clip switches
  from WSOLA to varispeed there. Only the sound stops.
- Pausing disconnects each clip's output, so a reverb does not ring on
  after the transport stops.

## Consequences

The sound-design drive (`scripts/drive/sound-design.js`, built through
MCP only) measures the exported WAV: the drums' 4 kHz-and-up band rises
65 dB when the low-pass opens at 5 s; the synth's pitch through the tape
stop is within 1.3% of the map's prediction at each of five moments; the
cathedral leaves an RMS of 0.31 just after the voice ends and none with
the reverb off; the pop's echoes come at 1.0, 0.5 and 0.25 of it.

Pre-roll costs render time: a 6 s cathedral makes each 10 s window
render 16 s. Playback started after a clip has ended misses its tail
(the clip is no longer scheduled); export and measurement do not. The
keyframe panel draws a cutoff's curve straight between keys while it
plays on a log scale. Compound clips take no effects yet (their sound is
many clips mixed through linear time maps, ADR-037), and
`normalize_loudness` measures a clip through its compressor but not its
filters: `measure_loudness` measures the mix as it plays (ADR-061).
