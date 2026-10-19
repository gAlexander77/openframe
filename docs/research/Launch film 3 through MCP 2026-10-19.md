---
type: research
date: 2026-10-19
---

# Launch film 3 through MCP 2026-10-19

The owner asked for the promo to be remade with this round's improvements,
voiced, "very natural", and edited entirely through OpenFrame's MCP tools.
This note records how it was made and every limit met, as feedback for the
product. The earlier film is [[Launch film through MCP 2026-10-18]].

## What was made

| Cut | Format | Loudness | Captions |
|---|---|---|---|
| Master | 68 s, 16:9 1080p30 | -14.2 LUFS integrated, -1.0 dBTP (ffmpeg's own measure) | An SRT file beside it |
| Vertical | 9:16 1080x1920 | Same | Burned in |

- **Voice:** a narrator in 14 lines (af_heart, natural finish, full precision).
- **Score:** generated in the app, 120 BPM in F minor, its drops at 8 s and
  40 s and its final hit at 60 s, where the end card lands.
- **Picture:** kinetic type with styled accent words, floating UI windows
  with shadows and tilt, macro push-ins, and soft radial glows.
- **Footage:** recorded headless from the improved web build (18 clips; the
  footage agent's SHOTS.md).
- **Done outside the editor:** the footage recording only. No sprites and
  no outside music this time.
- **Checks:** `check_project` passes with no warnings on both cuts, after
  fixes it pointed to (sizes, contrast, title-safe areas, the 9:16 app UI
  zones).

## How it was edited

About 30 MCP calls for the master, most of them `batch` (one per section,
built by small scripts), plus about 15 for the vertical copy.

1. **The score:** `plan_music` to try the form, then `generate_music` with
   section markers.
2. **The voice:** `add_voiceover` with every line pinned by `at` and a
   pronounce map. Then `review_voiceover`, then `retake_voiceover` on three
   lines and a re-review.
3. **The mix:** `duck_under_speech` with `voice_above_music_lu: 12`, met
   exactly.
4. **The picture,** section by section:
   - `add_shape` with radial gradients for the glows;
   - `add_text` with `style_text_range` for every accent word;
   - windows through `set_mask`, `set_shadow`, keyed `transform.rotateY`
     and `set_motion_blur`;
   - `frame_region` for the macros;
   - `add_sound_effect` with a list of whooshes.
5. **Checking as it went:** `preview_frames` and `preview_frame`, then
   `check_project` until it was clean.
6. **Exporting:** `export_video` with `loudness: -14` and `captions: srt`.
   For the vertical cut: `save_project_copy`, a 1080x1920 canvas, a re-layout
   by hand, `check_project` against the 9:16 zones, and an export with
   burned captions.

## What worked

- **The score fit the edit exactly.**
  - `plan_music`'s cue sheet landed every asked time on a bar line before
    anything rendered.
  - `generate_music` rendered 68 s in about 5 s at -14.0 LUFS.
- **Directed voice.**
  - Fourteen lines took 8 s, each starting at its beat.
  - `review_voiceover` heard every word and named three problems with
    exact fixes: music too loud, a misheard word, two slow lines.
  - After the duck, every line measured 10-18 LU over the music.
- **Accent words without extra clips.** `style_text_range` in a batch
  styled "choose.", "Frame", "every word." and the rest. The red dot of the
  LIVE badge is a run in the same title.
- **No sprites.**
  - Radial gradient shapes gave soft glows and blooms.
  - `set_shadow` and the tilt keys made the floating windows.
- **`check_project` earned its keep.** It caught:
  - text under the size floor;
  - contrast as low as 1.27:1;
  - three headlines past the title-safe edge;
  - on 9:16, everything inside the TikTok and Reels UI zones.

  Each finding named the box to move.
- **Captions on export:** a hidden caption track still exported as an SRT
  beside the master.

## Limits, ranked

### What the film could not do directly

1. **`export_versions` cannot restack a designed film for 9:16.**
   - **What broke:** a window beside a headline collapsed into overlaps; the
     split screen crowded.
   - **What it took:** a project copy and about 25 hand steps. The side
     headlines were dropped, the windows moved up, the full-frame shots
     reframed, and the captions resized for the app zones.
   - **Also:** `export_versions` has no `captions` option, so a burned-in
     vertical needs the caption track shown by hand.
   - *Fix:* a vertical re-layout rule for side-by-side compositions (stack
     a picture above its headline), `captions` on `export_versions`, and a
     caption size that follows the canvas's short side.
2. **`apply_layout` only cover-crops.**
   - Screen recordings in a split were cut to tall slivers.
   - Its new Layout tracks went above the existing title tracks and hid the
     labels.
   - *Fix:* a `fit` option (whole picture, letterboxed in the cell), and
     place Layout tracks under the topmost title tracks.
3. **Titles do not wrap to a 9:16 safe column on their own.** Line breaks
   had to be written in. *Fix:* a default wrap width that follows the
   canvas's safe column, or a `fit_width` helper.

### What misled the agent

4. **`set_text` dropped a title's styled run.**
   - Two separate edits (spaces to line breaks) put the styled phrase
     between them. The runs follow a common prefix and suffix, so a run in
     the changed middle is lost.
   - *Fix:* keep runs by position when the length is unchanged, and map
     them through a character diff otherwise.
5. **`review_voiceover`'s respelling suggestion was a placeholder.** It said
   `"does": "<spell it as it sounds>"`. A respelling ("duz") did not help
   either, and the line was reworded in the end. *Fix:* suggest a concrete
   respelling or a rewording, and say whether the voice or the recognizer
   is likely wrong (re-transcribe at a larger Whisper size, for example).
6. **The review's pace rule cannot be told a line is meant to be slow.**
   The end-card tagline was flagged as slow. *Fix:* a per-line pace intent,
   or an `ignore` list.
7. **A retake without a speed came back at 0.76.** The rushed-line rule
   chose it, without saying so. *Fix:* say in the answer when a speed was
   chosen for the agent.
8. **A clip added over another on the same track replaces it silently.**
   - Two glows on one track, and two labels on one track, lost the first.
   - In a batch, a later `$N` then pointed at a removed clip ("no clip
     with id").
   - *Fix:* report what was overwritten in the answer, or refuse unless
     `mode: overwrite` is given.

### What cost time

9. **Argument shapes differ between tools.**
   - `set_text` and `remove_keyframes` take one `clip_id`; most style tools
     take `clip_ids`.
   - `remove_keyframes` fails when a clip has no matching keys, which
     aborts a whole batch.
   - `generate_music`'s `markers` is a list of kinds.
   - *Fix:* `clip_ids` everywhere, and a no-op (reported) for nothing to
     remove.
10. **New tools are invisible to a running client.** Claude Code lists a
    server's tools when it connects, so this round's tools did not appear.
    A small client calling the HTTP endpoint was needed. *Fix:* send
    `notifications/tools/list_changed`, or document a reconnect.
11. **The score's brightness cannot be steered.**
    - The launch style came out dark: 75% of its power below 250 Hz and
      0.7% above 4 kHz.
    - Under a voice that is fine, but there is no `brightness` or EQ
      option.
    - Nobody has listened to it; the measurements are the only check.

## Found while recording the footage

- **Markers scroll away.** Marker flags and the playhead handle scroll off
  with the tracks, while the ruler stays pinned.
- **Number fields clamp each keystroke.** In the Generate music card,
  typing "120" into Tempo jumps to 40 on the first digit.
- **The docked assistant doesn't refit the timeline** when it opens.
- **Auto captions misheard the synthetic voice.** "All of it, home"
  became "Olivet Helmed". A voiceover's script is known, so its captions
  should be aligned from the script, not transcribed.
- **Applying a layout from the inspector rippled the main track.** Fixed
  this round: a main-track clip now stays in place.

## Media

The demo media inside the footage is the same CC0 (Wikimedia Commons) and
public-domain (NASA) set as before; the score and the voice were made by
the app. The film's own media list is in the footage folder's `SHOTS.md`.
