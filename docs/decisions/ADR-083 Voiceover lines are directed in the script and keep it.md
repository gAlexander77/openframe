# ADR-083: Voiceover lines are directed in the script and keep it

**Date:** 2026-10-19. **Status:** accepted.

## Context

The launch film's voiced versions ([[Launch film through MCP 2026-10-18]],
limit 10) showed that an agent could not direct a read: one voice and one
speed per `add_voiceover` call, no pauses, no say in how a name is
pronounced, and no way to hear the result. Undoing a voiceover also left
its speech files in the media library, because the files were imported as
an undo step of their own before the clips were placed.

A voice model reads a sentence with one intonation contour. Cutting it at
a pause and reading the halves apart resets the pitch at the cut and ends
the first half as if the sentence were over: the owner's rule is never to
chop a sentence into pieces whose prosody breaks.

## Decision

- **Direction lives in the script.** Each line of `add_voiceover` may
  carry its own `voice` (so several speakers are one call), `speed`, `at`
  (a timeline time; later lines follow it) and `pause_after`; with none,
  the gap after a line follows its ending (a sentence 0.4 s, a comma
  0.1 s, an ellipsis 0.6 s, a paragraph 0.8 s; `gap` still sets them all).
- **Pauses are written in the text**: `[pause]`, `[pause 0.4]`,
  `[pause 300ms]`, `[beat]`, or SSML's `<break time="0.4s"/>`
  (`lib/voiceScript.ts`). The caption never shows a mark.
- **A mark lengthens the voice's own pause.** The line is read whole; its
  pauses are found as dips in the envelope (often 60-100 ms dips, not
  silence) and matched to the script's punctuation by position, each
  pairing scored by the dip's length less the distance; the matched pause
  is set to the mark's length by replacing its middle, so the words and
  their intonation are untouched (`resizePauses`). Only when the voice
  ran through the mark is the line read in two parts, at that phrase
  boundary, the first given a comma so it keeps a continuing pitch.
- **`pronounce` respells words for the voice only** (whole words, case as
  written); the caption keeps the written words, and `review_voiceover`
  compares what it hears against both spellings.
- **The script stays with the take**: a speech file's asset keeps
  `speech` (`{text, caption?, voice, speed, pronounce?, quality?,
  finish?}`, [[Project format]]), so `review_voiceover` knows what the
  line should say and `retake_voiceover` can read it again with one thing
  changed. The same input reads the same way every time (the model is
  deterministic), so a retake must change something.
- **Listen back** (`review_voiceover`): Whisper hears each line and a
  word alignment that lets words run together or apart ("Open Frame" and
  "OpenFrame") names what was misread, skipped or added; the pace is
  judged in syllables (words a second runs high on short words); the
  silences, pitch range, loudness and margin over the music are measured
  (the mix as export renders it, as `measure_loudness` does), and each
  problem comes with the tool and arguments that fix it. A short word a
  letter off ("it" heard as "its") is reported as minor and passes.
- **Retake in place** (`retake_voiceover`): the clip keeps its id, start
  and settings and plays the new file; its caption takes the new words and
  length; the old file leaves the library when nothing else plays it; with
  `ripple` the lines and captions after it move by the difference. One
  undo step.
- **One undo step takes the speech files too.** Media made as part of an
  edit is probed without being added (`probeFiles`, `adoptAndProbe`) and
  added inside the edit that places it: `add_voiceover`, `text_to_speech`
  and `retake_voiceover`. The files stay on disk, as every removed media's
  do, so redo works.

## Consequences

- An agent can direct a read the way a voice director does (who says
  which line, where to breathe, how a name sounds), hear it back and fix
  one line without redoing the rest.
- The pause finder can miss a pause the voice made very short and shallow
  (under 60 ms, or less than 38 dB down); the mark then splits the line at
  that phrase boundary, which the answer reports as `split`.
- A clip whose file has no `speech` (a recorded read) is still reviewed:
  what was heard, pace, silences and levels, with no script to compare.
