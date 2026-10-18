# Agent playbook

<!-- Generated from src/lib/mcpGuide.ts by
     `UPDATE_MCP_DOCS=1 npx vitest run src/lib/mcpGuide.test.ts`;
     npm test fails when this file is out of date. Do not edit by hand. -->

How an AI model should make a video with OpenFrame's MCP tools. A model gets the same text three ways: the `help` tool (topics `ad`, `epic_edit`, `social_short`, `design`), the MCP prompts `make_ad`, `epic_edit` and `social_short`, and the resources `guide://...`. Every tool is in [[MCP tools]]; connecting is in [[Automation]].

## Design rules

- Hook: the product or the most striking image in the first 1-2 s; the proposition in the first 3 s, the hook within 6 s, the brand within 5 s (TikTok's and YouTube's creative guides).
- Pacing: ad shots average under 2 s (social ads 1-3 s, brand spots 2-5 s); epic edits cut on the beat, every 2-4 beats in a build and every beat after the drop.
- Words: one idea per title, 2-6 words for a headline, on screen long enough to read twice (about 0.4 s per word, 1.5 s at least); lower thirds 3-6 s; captions at most 20 characters a second, two lines.
- Type: at most two font families (a bold display face for headlines, a clean sans for the rest); headlines 8-12% of the frame height (size 90-160 at 1080p), nothing under size 40; inside the 90% title-safe area (align_clips margin 0.05); on 9:16 clear of the bottom 35% and the right 19%, where the apps' buttons sit (the viewer's TikTok, Reels, Shorts guide).
- Contrast: text over footage gets an outline, a shadow or a box (style.stroke, style.shadow, style.background); aim for 4.5:1 against what is behind it.
- Color: one grade over every shot (set_filter or apply_lut on an adjustment clip over everything), so the piece reads as one film.
- Motion: titles get an in and an out animation; push slowly into stills (frame_region); do not move everything at once; whip transitions follow the direction of motion.
- Flashes: never more than three flashes in any one second (WCAG 2.3.1; UK ad rules test for it).
- Sound: voice first, music ducked 10-15 dB under it (duck_under_speech), a whoosh on fast transitions, an impact on reveals with a riser whose peak lands on it, a beat of silence before the biggest hit; fade the music out over 1-2 s (set_fades).
- Loudness: online -14 LUFS with true peak at most -1 dBTP; EU broadcast -23 LUFS / -1 dBTP (EBU R128); US broadcast -24 LKFS / -2 dBTP (ATSC A/85).
- End: logo, product, one call to action and where to go, held 2-3 s.
- Check: preview_frames across the whole piece, preview_motion around cuts and moves, check_project for the rules above; fix, check again, then export.

## A professional ad

Making an ad (15, 30 or 60 s) with these tools:
1. new_project with a name; set_project for the shape: 1920x1080 for YouTube and TV, 1080x1920 for Reels, TikTok and Shorts, 1080x1080 or 1080x1350 for feeds.
2. import_media: product shots, b-roll, the logo (PNG with transparency), music. describe_project for asset ids and durations; preview_media to see what is in each video.
3. Script in beats: hook (0-3 s), problem or desire, the product, proof (features, numbers, a demo), offer, call to action. Write the voice lines short.
4. add_voiceover with the script: the voice and captions are placed at their real lengths and it answers where each line landed; cut the picture to the voice.
5. Picture: add_media_clip a shot under each line; frame_region for slow push-ins on stills and product details; set_canvas_fill blur when footage does not fill the frame; set_speed for slow motion on hero shots.
6. Words: a headline per idea with add_text (see Design rules), set_animation in and out; add_text_template for lower thirds and badges; set_caption_look for the captions (pop or boxed read well on social).
7. Look: one grade for all shots (an adjustment layer with set_filter or apply_lut over everything), set_transition dissolve or a fast cut between shots.
8. Sound: music with add_media_clip on an audio track, duck_under_speech under the voice, set_fades out at the end, add_sound_effect on reveals, normalize_loudness on the voice.
9. End card: logo, product, the offer and the call to action (Shop now, the URL) on a clean background, held 2-3 s.
10. preview_frames across the whole ad and check_project with kind ad; fix what they find (text cut off, too small, low in contrast, no end card); then export_video (loudness -14). For other shapes, set_project to the new size and auto_reframe the shots, check again, export again.

## An epic edit

Making an epic edit (a hype video, montage or music-synced velocity edit):
1. new_project; import_media the clips and one strong track (a clear beat and a drop).
2. Put the music on an audio track first and analyze_music it with markers beats, bars and drop: it answers the tempo, beats, bars, phrases, named sections (intro, build, drop, breakdown, outro) and the drop, in timeline seconds. Cut on downbeats and at phrase starts.
3. fit_music drop_at to slide the music so its drop lands where the edit's climax should be (often 25-40% in for a short edit).
4. preview_media each clip to find its best moments, then cut_to_beats with the shots in order (each with its in point): one call lays them end to end on the main track, every cut on the grid. Shape it to the music: intro (wide shots, bars, the title; pattern 4s), build (cuts every 2 beats), drop (every beat), breakdown (slow motion, a freeze with the title), final drop, logo. Run cut_to_beats per section with start and end, or one pattern for all.
5. Speed: velocity edits run fast between beats and slow on the hit: set_speed_ramp lands a clip's slow (or fast) moment on a beat without moving its cuts.
6. Hits: add_beat_hits flash, zoom, shake, rgb_split, glow or zoom_blur on the drop (marker_label Drop), on bars, or at_cuts; it keeps flashes to 3 a second. Transitions whipLeft, whipRight, zoomPunch or spinBlur at a few cuts, in the direction of the motion.
7. Look: one grade over everything (filter teal or a LUT on an adjustment clip), grain, and add_cinematic_bars (2.39) for a film feel.
8. Titles: big, short, bold words (one display face, size 160-240) with pop or zoomIn; text behind the subject (remove_background on a copy above the title) for the hero shot.
9. Sound design: add_sound_effect rise or reverseCymbal with end_at on the drop (it peaks there), impact, braam or subDrop on the drop's beat, whoosh on whip transitions; then fit_music end bar (or video) with fade_out to end the music cleanly.
10. preview_motion around the drop and other key cuts (the beats are listed beside the frames), check_project with kind epic_edit (cuts on the beat, no more than 3 flashes a second, no black), then export_video (loudness -14).

## A short for TikTok, Reels or Shorts

Making a vertical short from a talking-head clip or screen recording:
1. new_project; set_project 1080x1920; import_media.
2. add_media_clip the clip; remove_silences and remove_filler_words tighten the talk.
3. auto_reframe the clip to 9:16 (or frame_region onto the speaker or the part of the screen that matters); set_canvas_fill blur for anything that does not fill the frame.
4. Captions: the Captions tab's generator or add_captions with word times, then set_caption_look pop; keep them in the middle third, clear of the apps' buttons.
5. Hook title in the first second (add_text, size 120-160, with a box or outline), a few stickers or sound effects on punchlines (add_sticker, add_sound_effect).
6. Music low under the voice (duck_under_speech), set_fades, normalize_loudness.
7. preview_frames, then export_video with the social preset sizes (1080p).

## Prompts

- `make_ad`: Plan and edit a professional ad from the media given, following the ad playbook. Arguments: product (required), length, shape, media.
- `epic_edit`: Cut a music-synced montage or hype edit from the clips and track given. Arguments: theme (required), length, media.
- `social_short`: Turn a talking-head clip or screen recording into a captioned 9:16 short. Arguments: media (required), length.
