# Versions keep the subject (2026-10-19)

Codex's film test filled a 9:16 version from 16:9 shots by keeping each
shot's center, and lost the speedboat (left of center) and the Eiffel
Tower (right of center). A 9:16 frame filled from a 16:9 picture keeps
0.316 of its width, so a subject past about 0.34 or 0.66 of the width is
gone. This note records how the subject finder of
[[ADR-097 Checks and versions judge by the picture]] was chosen, so the
trials are not paid for twice.

## What existed

Nothing found a subject. `auto_reframe` follows whatever is in a box
(default: a square at the picture's center) with template tracking;
`frame_region` takes a region from the caller. The background model
(ormbg, IS-Net) segments a salient object, but it is an 88 MB download
that needs WebGPU with half precision, and its fallback segments people
only: too heavy and too narrow to run on every shot of every version.

## The footage

Twelve clips of the launch film's footage, one frame a second at 128 x 72.
Where the subject is, by eye: Paris, the tower at 0.67 of the width the
whole shot; speedboat, the boat at 0.35-0.39 for six seconds below an
island spanning 0.31-0.84, then its wake fills the frame and drifts left;
launch, the rocket at 0.48-0.50; skyline, the tall tower at 0.27.

## Trials

The number is the center of the best 0.316-wide window (column sums of
the map), per second.

| Cue | Paris (0.67) | Speedboat (0.36) | Verdict |
|---|---|---|---|
| Local color contrast (center-surround, Lab) | 0.52-0.84, jumping | 0.48-0.60, the island | Halos along the horizon; no |
| Global color contrast (frequency-tuned) | 0.49, then 0.84 | 0.84 | The horizon and the frame's edge; no |
| Minimum barrier distance (Lab) | 0.53-0.61 | 0.48-0.52 | Clean objects, but the island outweighs the boat by area and the sunset glow pulls Paris left |
| Frame differencing after a global shift | 0.55-0.77 | 0.16-0.30, the wake behind | Drone parallax leaves residue everywhere; no |
| Spectral residual (64 x 64, no taper) | 0.58-0.72 | 0.31-0.41 | Finds the boat; the frame's edges light up on other clips (launch 0.16, lake 0.84) |
| Spectral residual, outer tenth tapered | 0.56-0.66 | 0.34-0.45 | Good; a full Hann taper biases everything to the center |
| Barrier distance + spectral residual, squared | 0.57-0.60 | 0.43, then follows | The tower and the boat both inside, the boat near the window's edge |
| The same, fourth power, edges weighted down | 0.57-0.63 | 0.37, then follows the wake | Chosen |

Lessons:

- Area decides too much: a large, distinct region (an island, a sunset
  band) beats a small subject unless the strongest values count far more
  than the rest (the fourth power).
- A window's best position by total salience leaves the subject on its
  edge when other salience sits beside it; weighting the window's middle
  more (a sine profile, 0.2 at the edge) centers it.
- The spectral residual's FFT wraps the frame's edges into each other;
  tapering only the outer tenth removes that without pulling everything
  to the center.
- Choosing every sample's window alone wobbles; a Viterbi path with a
  cost per unit of pan holds a still subject still (Paris: one position)
  and follows a moving one (the wake).
- A frame of 128 x 72 takes 3-6 ms for both cues in Node.

## In the app

Paris (6 s with a gentle `frame_region` push) and the speedboat (6 s) as
a 16:9 master, `export_versions` 9:16 in the web build:

- The subject framing put Paris's window at 0.61 of the width (the tower
  at 0.67, in frame through the push) and the boat's at 0.38, then
  followed the wake; the check sheet flagged nothing.
- `reframe: "center"` lost both, and the sheet outlined both in orange:
  39% of Paris's subject and 59% of the boat's in frame at their worst.
- The sheet, with the looks, took 1.3 s.

## The subject for the check sheet

The blob holding the most salience over 60% of the map's peak. A framing
is flagged when it keeps under 65% of it where the subject framing keeps
90%, so the subject framing never flags itself, and only where the shot
is seen (not under an end card fading in: coverage is judged in the
middle of each stretch). Flagging a subject "wider than the frame" needs
it to be a figure, not a band: a sunset's glow is wider than a 9:16
window but is not a subject. A full-frame fractal photo is a figure wider
than 9:16 and is flagged so, with fit `blur` as the way to show it whole.

## Left

- Recognition: saliency finds what stands out, not who speaks. A bright
  sail beside a speaker would win. `focus` corrects a shot by hand.
- The trials were on aerial and landscape footage; people and products
  (the ad case) were not tried here. Faces are salient to both cues but
  were not measured.
