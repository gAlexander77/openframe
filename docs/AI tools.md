---
tags: [ai, analysis, silence, scenes, beats]
created: 2026-10-13
updated: 2026-10-13
status: living
---

# AI tools

The first local "AI" tools: **Remove silences**, **Split scenes** and **Beat
markers**. None of them is a neural network. Each one is a small piece of
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

### Credits: PySceneDetect

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
