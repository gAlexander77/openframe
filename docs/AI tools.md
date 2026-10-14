---
tags: [ai, analysis, silence, scenes, beats, loudness, ducking]
created: 2026-10-13
updated: 2026-10-14
status: living
---

# AI tools

The first local "AI" tools: **Remove silences**, **Split scenes**, **Beat
markers**, **Normalize loudness** and **Auto ducking**. None of them is a neural network. Each one is a small piece of
classic signal processing that runs on the user's machine, in the webview,
with no model download, no key and no network. Choices and sources are in
[[AI and automation]] §2.3, §2.5 and §2.6; this note is what we actually
built, its parameters and defaults, and where each idea came from.

Code: the algorithms are pure TypeScript in `src/lib/analysis/` (tested on
synthetic signals), the decoding is `src/engine/analyze.ts`, and the app
glue is `src/state/ai.ts`.

## Remove silences

`src/lib/analysis/silence.ts`. The audio is decoded to mono at 16 kHz, cut
into 20 ms windows, and each window's RMS level is measured in dBFS.

1. **Threshold relative to the noise floor.** The noise floor is the 10th
   percentile of the window levels: the quietest tenth of the clip, which in
   any recording with pauses is room tone. The threshold is the floor + 8 dB,
   clamped to −50…−30 dBFS. The clamp matters at both ends: digital silence
   has a floor of −∞ (so the threshold would be meaningless), and a clip
   with no pauses has a "floor" that is speech (so the threshold would cut
   words). An absolute threshold (`thresholdDb`) overrides all of this.
2. **Hysteresis.** A silence starts when the level drops 3 dB below the
   threshold and ends when it reaches the threshold, so a level hovering at
   the threshold does not chatter into dozens of tiny cuts.
3. **Blips.** A loud run shorter than 100 ms (a click, a tap on the desk)
   does not split a pause in two.
4. **Minimum length and padding.** Pauses shorter than 0.4 s stay (they are
   the rhythm of speech). Longer ones are cut, minus 0.1 s of padding on
   each side that touches speech, so words keep their breath and attack.
   The start and end of the file get no padding.

| Option | Default | UI |
|---|---|---|
| `window` | 0.02 s | — |
| `marginDb` | 8 dB over the floor | — |
| `minDb` / `maxDb` | −50 / −30 dBFS | — |
| `biasDb` | 0 | Sensitivity: 0…100 maps to −8…+8 dB (higher cuts quieter sound) |
| `thresholdDb` | automatic | Agents only |
| `hysteresisDb` | 3 dB | — |
| `minSilence` | 0.4 s | Min pause |
| `padding` | 0.1 s | Padding |
| `minSpeech` | 0.1 s | — |

Where it came from: ffmpeg's `silencedetect` (an RMS gate with a minimum
duration) for the core, and the editor variant in [[AI and automation]]
§2.3 (floor-relative threshold, clamp, hysteresis, padding) for everything
an editor needs on top. Cuts fall inside the silence, so the joins need no
crossfade to avoid clicks.

**Gaps.** Energy cannot tell a pause with music or traffic under it from
speech. A voice activity model (Silero VAD, MIT, 2 MB) is the planned
upgrade; it replaces step 1 and keeps steps 2–4.

## Split scenes

`src/lib/analysis/scenes.ts`, a port of PySceneDetect's ContentDetector,
FlashFilter and AdaptiveDetector (see the credits below). Frames are
decoded 128 px wide, converted to HSV in OpenCV's 8-bit ranges (H 0–179,
S and V 0–255, which is what PySceneDetect's thresholds are tuned in), and
each frame gets a **content score**: the mean absolute per-pixel difference
from the previous frame, averaged over H, S and V. Only the scores are
kept, so analysis memory does not grow with the video's length.

- **AdaptiveDetector (default).** A frame is a cut when its score is at
  least 3× the mean of its 2 neighbors on each side *and* at least 15. A
  fast pan or handheld shake scores high on every frame, so its ratio stays
  near 1; a cut stands out from both sides. The tests pin exactly this
  case: the content detector sees a pan as two cuts, the adaptive one does
  not.
- **ContentDetector.** A cut is any frame scoring 27 or more. Simpler,
  zero latency, fooled by motion. Offered for footage the adaptive detector
  under-cuts.
- **Minimum scene length** (0.5 s, PySceneDetect's 15 frames at 30 fps).
  The content detector applies it through the FlashFilter: in *merge* mode
  (default) a burst of cuts closer together than the minimum (a strobe, a
  flash-frame edit) becomes one cut at the burst's last frame; *suppress*
  keeps the first. Like PySceneDetect, the first cut must also be the
  minimum length from the start of the clip.

| Option | Default | UI |
|---|---|---|
| `detector` | `adaptive` | Detector: Adaptive / Fixed |
| `adaptiveThreshold` | 3.0 | Sensitivity: 0…100 maps to 6.0…1.5 (halving per 50) |
| `threshold` (content) | 27 | Sensitivity: 0…100 maps to 38…19 |
| `minContentVal` | 15 | Sensitivity: 0…100 maps to 21…11 |
| `windowWidth` | 2 frames | — |
| `minScene` | 0.5 s | Min scene |
| `filter` | `merge` | — |

Output: the clip is split at each cut (`split_at_times`), or markers are
dropped there (`add_markers`), Premiere's "Scene Edit Detection" options.

**Gaps.** No edge component (PySceneDetect's default weight for it is 0
anyway). Dissolves and fades are not cuts to this detector; PySceneDetect's
ThresholdDetector (fades to black) and TransNetV2 (MIT, gradual
transitions) are the upgrades listed in [[AI and automation]] §2.5.

## Beat markers

`src/lib/analysis/beats.ts`. The audio is decoded to mono at 22.05 kHz.

1. **Onset strength (spectral flux).** Hann-windowed 1024-point FFTs, 100
   frames a second, magnitudes summed into 64 mel-spaced bands (30 Hz to
   11 kHz), log-compressed (`log1p(100·x)`), and the increases from the
   previous frame summed. Mel bands matter: with plain FFT bins a hi-hat's
   noise covers hundreds of bins and outvotes the kick drum that carries
   the beat. Frames are centered, so the flux peaks a little before the
   attack; 8 ms is added back (measured on the test click tracks).
2. **Tempo.** Autocorrelation of the onset envelope (smoothed with a 20 ms
   Gaussian first, or a period of 46.9 frames splits its peak between lags
   46 and 47 and the doubled period wins), weighted by a log-normal prior
   centered on 120 BPM with one octave of spread, over 40–240 BPM. The
   peak is refined to a fraction of a frame by parabolic interpolation.
3. **Beat tracking.** Ellis's dynamic programming tracker, as in librosa's
   `beat_track`: each frame's score is its onset strength plus the best
   earlier beat between half and twice a period back, penalized by
   `tightness · log(gap / period)²` (tightness 100). Backtracking from the
   end yields the chain of beats that best balances landing on onsets with
   keeping time.
   - *Last beat:* librosa starts from the latest strong peak. Beats and
     off-beats form two chains with the same period, and whichever ends
     later would win; we take the strongest peak within a period of the
     end instead (pinned by a test).
   - *Trim:* leading and trailing beats weaker than half the RMS onset
     strength at the beats are dropped (count-ins, fade-outs, and the
     phantom beat the DP places one period after the music stops).
4. **BPM.** 60 / the least-squares slope of beat time against beat index,
   which averages out each beat's 10 ms frame grid.

| Option | Default | UI |
|---|---|---|
| `minBpm` / `maxBpm` | 40 / 240 | — |
| `priorBpm` | 120 | — |
| `tightness` | 100 | — |
| marker every N beats | 1 | Every: 1, 2 or 4 beats |

Measured on synthetic loops (kick, high-passed hat on the off-beat, a held
chord): 90, 100 and 128 BPM come out within 0.1 BPM, every beat within
5 ms of the truth.

Where it came from: spectral flux onset detection (Bello et al., "A
Tutorial on Onset Detection in Music Signals", 2005; log compression after
Böck and Widmer), the tempo prior and the DP tracker from Ellis (2007) and
their librosa implementation (ISC license; we read its documentation and
behavior, no code was copied). Beat This! (MIT) is the planned upgrade for
downbeats and tempo changes; madmom (non-commercial models), aubio (GPL)
and Essentia (AGPL) are ruled out ([[AI and automation]] §2.6).

**Gaps.** One tempo per clip, no downbeats or bars, no tempo changes.
Markers sit on the timeline, not on the clip, so they stay put if the
music clip moves.

## Normalize loudness

`src/lib/analysis/loudness.ts`, CapCut's "Normalize loudness" measured the
broadcast way (ITU-R BS.1770 / EBU R128, [[AI and automation]] §2.10).

1. **Measure.** The clip's source window streams through a meter at the
   source's own rate and channels (nothing is held but one number per
   100 ms): K-weighting (a +4 dB shelf above ~1.7 kHz and a 38 Hz
   high-pass, coefficients computed for any rate as libebur128 does; at
   48 kHz they equal the standard's table), mean square per 100 ms,
   400 ms blocks overlapping 75%, an absolute gate at −70 LUFS and a
   relative gate 10 LU under the mean. Channels are summed; **mono counts
   twice** because it plays on both speakers — the same reading as
   `ffmpeg -af ebur128=dualmono=true`.
2. **Set the volume.** `target − measured` dB, held back so the sample
   peak stays under −1 dBFS, and within the inspector's −60…+12 dB. All
   selected clips in one undo step ("Normalize loudness of 2 clips").

| Option | Default | UI |
|---|---|---|
| target | −14 LUFS | Social −14, Podcast −16, Broadcast −23 |
| peak ceiling | −1 dBFS (sample peak) | — |

Measured: the fixtures read −14.17 and −14.63 LUFS where ffmpeg's
`ebur128` reads −14.2 and −14.6; a stereo clip normalized to −16 and
exported measures −16.0 LUFS in ffmpeg.

**Gaps.** Sample peak, not true peak (inter-sample peaks can pass the
ceiling by a fraction of a dB); surround weights (1.41 on the rear pair,
no LFE) need the channel layout; clips with volume keyframes are skipped;
track volume is not taken into account.

## Auto ducking

`src/lib/analysis/duck.ts`. Select the music; every other clip with sound
that plays with it (not muted or disabled) is listened to for speech with
the silence detector above (speech = wherever it finds no silence). The
music then gets **volume keyframes** — editable afterwards in the keyframe
panel, unlike CapCut's ducking, which is a switch you cannot shape:

- down by the depth (Light 6, **Medium 12**, Strong 18 dB; guides put
  music 10–15 dB under dialogue) from 0.1 s before each stretch of speech
  (attack, so the first word is clear) to its end;
- back up over 0.4 s (release);
- pauses shorter than attack + release + 0.6 s stay ducked, so the music
  does not pump between sentences.

Existing volume keyframes on the music are replaced, in one undo step
("Duck under speech"). Measured on the fixtures: four 1.6 s bursts of
speech every 3 s give four dips, −12.00 dB inside speech and 0 dB in every
pause, and the exported music is 12.0 dB quieter under speech than in the
pauses.

**Gaps.** Every other audible clip counts as speech, music included; a
speech/music classifier is the upgrade. One depth for the whole clip.

## In the app and for agents

- **Panel:** the library's *AI tools* tab (`src/components/AiToolsTab.tsx`).
  A banner names the selected clip; each tool card says what it needs,
  opens its settings in a small popover, shows progress with a cancel
  button while it runs, and keeps its last result ("Removed 4 silences,
  4.9 s shorter"). *Auto captions* opens the Captions tab; *Auto reframe*
  is marked as coming soon.
- **One undo step per run**, labeled with what happened ("Remove 4
  silences", "Split into 5 scenes", "Mark 43 beats"), built from the
  registry commands `cut_ranges`, `split_at_times` and `add_markers`
  ([[ADR-019 Smart edits compile to commands, one undo step]]).
- **Automation:** `window.videoEditor.analyze.silences | scenes |
  beats(clipId?, options?)` return results in source seconds without
  editing ([[ADR-017 Analysis edits take source seconds]]);
  `window.videoEditor.ai.removeSilences | splitScenes | markBeats` analyze
  and apply. Omitting `clipId` uses the selected clip.
  `ai.normalizeLoudness(clipIds?, { target })` takes a list and returns
  each clip's measured LUFS, gain and whether the peak held it back;
  `ai.duckUnderSpeech(clipId?, { depth })` returns the dips and keys made.
- **Proof:** `scripts/drive/ai-tools.js` runs every tool on fixtures with
  known answers (`node scripts/make-fixtures.mjs`) and once through the
  panel. Measured in Edge on 2026-10-14: silences exactly 1.7–2.9, 4.7–5.9,
  7.7–8.9 and 10.7–12 s (4.9 s removed, video and its sound cut together);
  scene cuts on the exact frames (2.5, 5, 8, 10 s) with both detectors,
  360 frames analyzed in about 0.7 s; 128 BPM with all 43 beats within
  5 ms.

## Decoding

`src/engine/analyze.ts` opens its own mediabunny Input per job (playback
decoders never move), decodes only the clip's source window, and keeps
only what the algorithm needs ([[ADR-018 Local analysis is our own signal
processing in the webview]]):

- **Audio:** channels averaged to mono, resampled by a box filter (each
  output sample is the mean of the input samples in its slot) to 16 kHz
  for silence and 22.05 kHz for beats.
- **Video:** every frame drawn 128 px wide by mediabunny's `CanvasSink`,
  converted to HSV, scored against the previous frame, then dropped.

**AAC priming (measured).** AAC encoders put 1024 samples of priming
before the audio; an MP4 edit list says to skip them. mediabunny honors
the edit list by giving that first packet a *negative* timestamp
(−21.3 ms at 48 kHz, −23.2 ms at 44.1 kHz on our fixtures, video at 0).
Mapping the first timestamp to source time 0, as `media.ts` and
`thumbs.ts` do, puts the priming at 0 and every sound 21 ms late: the
silence edges and beats came out 21 ms late until the analysis decoder
switched to mapping timestamp 0 (or a later first timestamp, for streams
that start late) to source 0. Beat error on the 128 BPM fixture went from
27 ms to 5 ms. The same offset is likely in playback and waveforms.

## Credits: PySceneDetect

The scene detector reimplements, in TypeScript, the algorithms of
PySceneDetect (<https://github.com/Breakthrough/PySceneDetect>), read from
its main branch in October 2026, which is distributed under this license:

```text
BSD 3-Clause License

Copyright (C) 2014, Brandon Castellano

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The shipped app must carry this notice in its about box or third-party
notices file once that exists.
