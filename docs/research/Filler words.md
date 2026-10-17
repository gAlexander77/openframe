---
type: research
date: 2026-10-16
---

# Filler words

What it takes to cut "um" and "uh" out of speech with the local Whisper
models the app already ships for captions, measured on this computer.
Code: `src/lib/fillers.ts` (which words, which ranges), `analyzeFillers` /
`removeFillers` in `src/state/ai.ts`, drive `scripts/drive/fillers.js`.

## What the others do

CapCut's Remove filler words and Premiere's transcript both flag fillers
from their own speech models, then cut them with the pause around each
and close the gap. Both treat it as a transcript operation, so the cut
follows the recognizer's word times.

## Whisper is trained toward clean text

Kokoro (the app's local text to speech) read "So, um, I think we should,
uh, go there. Um, well, it is, uh, fine. Hmm, er, okay." Each English
model transcribed the mix (transformers.js 4.3, `return_timestamps:
"word"`):

| Model | "um" (2) | "uh" (2) | "hmm" | "er" |
|---|---|---|---|---|
| tiny.en (41 MB) | dropped | dropped | "hum" | "or" |
| base.en / base (77 MB) | kept | dropped | "hum" | "or" |
| small.en (249 MB) | kept | dropped | "Hum" | "or" |

- **"uh" is dropped by every model.** Its sound is folded into the
  neighbors' timestamps ("should@1.40-1.58 go@1.58-1.92"), so a gap
  between words does not reveal it either.
- **"er" comes back as "or"**, a real word, so it cannot be cut by text.
  "hmm" comes back as "hum", which is in the list.
- **Tiny is useless for this**; the tool offers base (default) and small.
- OpenAI's guidance for verbatim fillers is a prompt that contains them.
  transformers.js 4.3 has `prompt_ids` only as a commented-out parameter
  of `WhisperForConditionalGeneration.generate`, so prompting is not
  available; revisit when it lands.

## Cutting at the right place

- **A filler's timestamp can be a 20 ms sliver** ("um,@0.62-0.64" with the
  next word at 0.90) while the sound fills the gap. The cut runs from the
  previous real word's end to the next real word's start, at most 0.35 s
  past the filler's own stamps, so the hesitation goes and a long pause
  stays.
- **Cutting right up to a neighbor's stamped start nipped "well" into
  "while"** on re-transcription. A 40 ms guard beside each neighbor fixed
  it: every word was heard again after the cut.
- **Consecutive fillers** ("um, uh") are bounded by the nearest real words,
  not by each other; the first version let the first filler's reach run
  into the word after the second.

## Ceiling

`ponytail:` English fillers only (the list in `FILLERS`); "uh" and "er"
stay until a recognizer transcribes them verbatim. A wider list ("like",
"you know") needs context to tell filler from meaning, which CapCut also
leaves to the user.
