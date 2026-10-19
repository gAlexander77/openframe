# ADR-092: A voice's known script decides its words, a second hearing decides who misheard

**Date:** 2026-10-19. **Status:** accepted.

## Context

[[ADR-083 Voiceover lines are directed in the script and keep it]] keeps
each take's script with its file (`Asset.speech`). The third launch film
([[Launch film 3 through MCP 2026-10-19]]) showed three ways the app still
trusted Whisper over that script:

- **Auto captions misheard the voice.** The Captions tab transcribes the
  timeline's mix, so "All of it, home" was captioned "Olivet Helmed".
- **`review_voiceover` blamed the voice for Whisper's mistakes.** Every
  difference became a retake, and a word it could not respell got the
  placeholder `"does": "<spell it as it sounds>"`. A respelling ("duz") did
  not help either; the line was reworded in the end.
- **The pace rule could not be told a line is meant to be slow.** The
  end-card tagline was flagged as slow.

## Decision

- **A known script is what the voice says.** Where a whole take with a
  script plays on a track that sounds, automatic captions use the
  script's words (its caption, else its written words without pause
  marks), timed by Whisper (`scriptTimes`): the script's tokens and the
  heard tokens are aligned by edit distance (numbers and symbols compare
  as said), each script word takes the time of the heard words it lines up
  with, and a run of words not heard shares the time between its
  neighbors by length. The transcript (`get_transcript`, the Transcript
  panel) does the same for a whole take. A trimmed or cut piece says only
  part of its script, so Whisper's words stand there. `add_captions` keeps
  taking the captions it is given.
- **A difference is heard twice before the voice is blamed.** A line that
  differs from its script is heard again by Whisper small (249 MB,
  downloaded once) after every line has been heard by base. A difference
  the second hearing does not make is the first recognizer's (`likely:
  recognizer`): no retake, a note says so. One it makes too is likely the
  voice's (`likely: voice`). `recheck: false` skips it; a model that cannot
  load leaves the summary saying so.
- **A fix is always concrete.** A misread word gets a respelling: letters
  for an acronym, CamelCase apart, then the word as it sounds (a table of
  words English spells against their sound, "does" "duz", then the usual
  rules, "home" "hohm"), then a long word in syllables. A word already
  respelled, or one nothing reads differently, gets a slower read and the
  advice to reword the line. No fix carries a placeholder.
- **A line's pace intent is kept with its script.** `pace` (`slow`,
  `normal`, `fast`) on an `add_voiceover` line or a retake is stored in
  `Asset.speech`. Review holds a slow line to 2 syllables a second instead
  of 3.2, a fast one to 7.5 instead of 5.6, and the natural finish does not
  read a fast line again slower for being rushed.

## Consequences

- `src/lib/scriptWords.test.ts` and `src/lib/voiceReview.test.ts` cover the
  alignment, the second hearing's judgment, the respellings and the pace.
- `scripts/drive/script-captions.js` and `scripts/drive/voice-review-fixes.js`
  run the real voice and Whisper: takes made to say other words than their
  scripts are captioned in the scripts' words; review hears them again,
  calls them the voice's, respells "home" as "hohm" (the retake is heard
  right) and passes a slow tagline marked `pace: slow`.
- **The second hearing costs a download** the first time a review finds a
  difference (about 250 MB), and a few seconds a doubtful line after.
- **Whisper decides the times, not the words.** Captions of a scripted
  voice are as well timed as Whisper's hearing; a word it did not hear at
  all is placed between its neighbors.
- **The rules table is small.** It covers common irregular words and
  English spelling rules, not every name; the syllable fallback is a
  respelling a voice reads differently, not always right.
