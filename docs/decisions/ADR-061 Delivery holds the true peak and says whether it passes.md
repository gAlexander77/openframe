# ADR-061: Delivery holds the true peak and says whether it passes

**Date:** 2026-10-18. **Status:** accepted.

## Context

An agent making an ad must deliver it to a spec: -14 LUFS for YouTube,
Spotify and TikTok, EBU R128 (-23 LUFS, true peak at most -1 dBTP) for
European broadcast, ATSC A/85 (-24 LKFS, at most -2 dBTP, the US CALM
Act's practice) for US TV. Export loudness (ADR-053's limiter) reached a
target with a limiter on sample peaks under -1 dBFS, but the specs are
in dBTP: the peak a DAC or a lossy decoder reconstructs between samples,
up to 3 dB over the samples at a quarter of the sample rate. And an agent
had no way to read a mix's loudness at all before exporting it.

Research for the measurement: ITU-R BS.1770-4 Annex 2 asks for 4x
oversampling and gives a 48-tap interpolation filter as an example;
libebur128 designs its own (a 49-tap windowed sinc), and implementers
report the generated filter meets EBU Tech 3341's true-peak tests
(signals 15-23, +0.2/-0.4 dB) more closely than the table. EBU Tech
3342 defines loudness range on short-term (3 s) loudness read at 10 Hz
or more, gated at -70 LUFS and then 20 LU under the power mean of what
passed, as the spread from the 10th to the 95th percentile; its MATLAB
listing is the reference.

## Decision

- **A true-peak meter** (`src/lib/analysis/truePeak.ts`): 4x polyphase
  interpolation by a 49-tap Hann-windowed sinc, phase 0 the samples
  themselves. On Tech 3341's signals 15 to 19 it reads within 0.05 dB.
- **Export's limiter holds the true peak.** The measuring pass gives each
  1 ms block its true peak (the interpolated values placed by the sample
  they follow, less the filter's 6-sample delay), and `planLoudness`
  (`src/lib/analysis/delivery.ts`, shared by export and measurement)
  raises the mix and limits those blocks. The gain changes slowly beside
  the interpolator's span, so the result lands on the ceiling: -1.0000
  dBTP after 5.4 dB of limiting in the unit test, with no margin needed.
- **Specs by target.** `online`, `ebu_r128` and `atsc_a85` carry target,
  tolerance and true-peak ceiling. A bare target a spec owns brings its
  ceiling (-24 holds -2 dBTP), any other -1 dBTP, so the export dialog's
  new -24 LKFS entry and `export_video`'s `loudness` need no second field.
  `normalize_loudness` takes `spec` and holds clips' true peaks too.
- **`measure_loudness`** renders the mix through the same pre-rolled
  windows as export (`src/engine/mixdown.ts`) and answers BS.1770
  integrated loudness, Tech 3342 loudness range, the loudest 3 s and
  400 ms (Tech 3341), true and sample peak, and `pass` with the problems
  in sentences against one spec or all three; `clips` when the float mix
  passes full scale (a file of it would square off); a `fix` naming the
  export or normalize call that meets the failed spec. With `loudness`
  it measures what `export_video` at that target delivers, raised and
  limited as export does, so an agent checks the deliverable before it
  writes it. It is an MCP app tool through the host's `ai()` route, as
  the other long measurements are, with a progress toast for the user.

## Consequences

On the sound-design drive's 10 s mix the report agrees with an
independent reading of the exported WAV (LoudnessMeter, Tech 3342's
listing written out in the drive, and a true peak from the browser's own
resampler, `decodeAudioData` at 192 kHz): integrated -16.6 against
-16.56 LUFS, LRA 9.0 against 8.95 LU, true peak -2.8 against -2.82
dBTP. An export at -10 LUFS measures -1.004 dBTP that way after 4.7 dB
of limiting. The first mix the drive built summed to +3.1 dBFS, which
the WAV clipped to full scale: hence `clips`.

The true peak is held in the mix, before the encoder; AAC can add a
fraction of a dB, which is why ATSC leaves 2 dB. Momentary and short-term
maxima step at BS.1770's 100 ms, so an isolated burst exactly 400 ms long
can read up to 0.6 dB low (Tech 3341's file-based test 13 needs finer
steps). Surround weighting stays as LoudnessMeter has it (one per
channel).
