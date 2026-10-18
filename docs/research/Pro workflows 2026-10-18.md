---
type: research
date: 2026-10-18
---

# Pro workflows 2026-10-18

The owner wants an AI model to make, through the MCP tools alone, a fully
professional ad or an "epic edit" (a hype video, montage or music-synced
velocity edit). This note records how professionals make both, the rules
of thumb they follow, and what OpenFrame lacked for each. The rules are
what the `help` tool, the MCP prompts and [[Agent playbook]] teach a
model. Desk research from official guides, delivery specs and well-known
tutorials; where a figure comes from a vendor or trade blog, it says so.

## How ads are made

- **Brief first:** one message, one audience, and every version
  (aspect × length × loudness) planned from the start
  (https://www.moonb.io/blog/commercial-video-production).
- **Voice before footage:** record the script, then cut the picture to
  the line times; an animatic locks timing before polish.
- **The opening:**
  - The proposition in the first 3 s and the hook within 6 s
    (https://ads.tiktok.com/help/article/creative-best-practices).
  - Brand or product within 5 s, with two or more shots there, and the
    logo on the product rather than floating (YouTube's ABCDs, a
    third-party summary:
    https://www.smartinsights.com/social-media-marketing/youtube-marketing/the-abcds-of-developing-stand-out-video-creative-on-youtube/).
- **Pace:** commercial shots averaged under 2 s in a 1991 study
  (https://www.warc.com/Content/421e1376-baa5-472f-aa9d-adc58bea5146).
  End on a clear call to action.
- **Type:**
  - Two typefaces, heading and body
    (https://www.premiumbeat.com/blog/7-must-know-guidelines-for-motion-title-design/).
  - Nothing small in HD; hold text long enough to read twice; a shadow
    on anything meant to be read
    (https://larryjordan.com/articles/make-your-text-look-great/).
  - Contrast at least 4.5:1
    (https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html).
  - Lower thirds 3–6 s
    (https://www.epidemicsound.com/blog/lower-thirds/).
  - Captions at most 20 characters a second and two lines of 42 (a
    third-party summary of Netflix's English style guide).
- **Safe areas:** SMPTE ST 2046-1 sets action safe at 93% and title safe
  at 90% of the frame, replacing RP 13 and RP 8's 90% and 80%
  (https://backlothelp.netflix.com/hc/en-us/articles/4406208331923-Title-Safe-and-Safe-Action-Best-Practices).
  On 9:16 the apps' interfaces cover more; see [[Everyday gaps 2026-10-17]].
- **Mix:** voice first, the music ducked, sound effects. Then the spec:

  | Delivery | Loudness | True peak | Source |
  |---|---|---|---|
  | US broadcast | −24 LKFS | −2 dBTP | AICP: https://www.aicp.com/assets/editor/AICP_File_Deliverable_Specifications_Feb_2018.pdf |
  | EU broadcast | −23 LUFS | −1 dBTP | EBU R128: https://tech.ebu.ch/docs/r/r128v4_0.pdf |
  | Online | −14 LUFS | about −1 dBTP | https://support.spotify.com/us/artists/article/loudness-normalization/ |
- **Deliver:**
  - 30, 15 and 6 s versions (YouTube bumpers are 6 s).
  - 16:9, 9:16, 1:1 and 4:5.
  - A textless version.
  - Masters in ProRes 422 HQ with a slate.
  - Uploads as H.264 High at about 8 Mbps for 1080p, with AAC-LC at
    48 kHz (https://support.google.com/youtube/answer/1722171).
- **Flashing:** UK ad rules ask for a Harding test; WCAG 2.3.1 allows at
  most three flashes in any second
  (https://www.w3.org/WAI/WCAG20/Understanding/three-flashes-or-below-threshold;
  https://www.asa.org.uk/news/flashing-images-in-advertising.html).

## How epic edits are made

- **Analyze the track:** BPM, downbeats, sections and the drop. Final
  Cut's beat grid shows song parts, bars and beats
  (https://support.apple.com/guide/final-cut-pro/ver65b55a2b7/mac).
- **Shape:** intro (wide shots, bars, the title) → build (a riser,
  cuts every 2 beats) → drop (every beat, hits) → breakdown (slow
  motion, a freeze with an outline and the title) → final drop → logo.
- **Cut on downbeats and phrase starts,** in the quiet just before the
  beat (https://www.storyblocks.com/resources/tutorials/how-to-edit-video-to-music).
- **Velocity:** fast between beats, slow on the hit
  (https://www.capcut.com/resource/how-to-do-velocity-on-capcut;
  https://aejuice.com/blog/how-to-do-velocity-edits-after-effects).
- **Transitions:**
  - Whip pans follow the direction of motion and are not overused
    (https://flexclip.com/learn/whip-pan-transition.html).
  - Zoom and shake transitions use mirrored edges, so no black shows
    (https://motionarray.com/learn/after-effects/zoom-blur-transition-after-effects/).
  - Motion blur at a 180° shutter, After Effects' default
    (https://www.provideocoalition.com/motion_blur/).
- **Sound:** the riser's peak lands on the impact or sub drop; silence
  just before the slam (https://sounddesign.irpr.agency/glossary/riser/;
  https://violetrecording.com/sound-design-for-trailers/).
- **Look:** a teal-orange or cinematic grade, grain, with glow and RGB
  split used sparingly.

## What OpenFrame lacked, and who took it

The research ranked about thirty gaps. Work on the `improvements` branch
took them as follows (statuses in [[History]] when each lands):

- **Epic-edit toolkit:**
  - music structure as data (beats, downbeats, sections, energy, the
    drop);
  - cutting a list of shots to the beat;
  - beat hits;
  - speed ramps placed on beats;
  - cinematic bars;
  - fitting music to the video;
  - more synthesized sound effects;
  - whip, zoom and spin transitions.
- **Ad toolkit:**
  - per-letter and per-word text animation;
  - text behind a subject;
  - a brand kit in the project;
  - ad elements (end card, lower third, badge, logo reveal);
  - versions per aspect;
  - text glow and gradient.
- **Compositing:**
  - track mattes;
  - shape layers;
  - motion blur from movement;
  - mirrored edges;
  - spring, bounce and elastic easing and wiggle.
- **Sound and delivery:**
  - filter sweeps, reverb, echo and tape stop;
  - broadcast loudness targets with true peak;
  - a loudness report.
- **The MCP layer:**
  - the guide and prompts;
  - the missing commands (blend, chroma key, canvas fill, fades in
    seconds, duplicate);
  - the safe-area values;
  - a design check;
  - motion previews;
  - previews of source media.
- **Left for later:**
  - optical-flow slow motion;
  - Lottie import;
  - pen and multiple masks;
  - ProRes masters with slate (the desktop FFmpeg path);
  - 3D extruded text;
  - the subject outline and glow look.
