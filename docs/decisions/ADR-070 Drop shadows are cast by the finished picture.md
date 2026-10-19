# ADR-070: Drop shadows are cast by the finished picture

**Date:** 2026-10-18. **Status:** accepted.

## Context

The launch film's floating UI windows (footage in a rounded mask, a
border and a bar, made one unit as a compound clip) needed a soft shadow
under them, and the editor could only shadow titles (`style.shadow`,
drawn with the letters by Canvas2D). The film used a shadow sprite.
After Effects, CapCut and Premiere all offer a drop shadow on any layer:
a blurred, offset, tinted copy of its alpha, under it. The film's windows
could not tilt in 3D either, as product films' often do.

## Decision

- A visual clip's `shadow: { color, blur, x, y, opacity }`; blur is twice
  the Gaussian's sigma (CSS box-shadow's blur radius, and the same
  meaning as the text shadow's), x and y the fall, all pixels at 1080p;
  opacity multiplies the color's alpha. The numbers keyframe
  (`shadow.blur`, `shadow.x`, `shadow.y`, `shadow.opacity`).
- **Cast last, from the finished layer**: after the layer pass (mask,
  crop, chroma key, color), the effects and the track matte, the
  compositor blurs the layer's picture on the blur pyramid
  ([[ADR-069 Large blurs run on a downsampled pyramid]]), reads its alpha
  back moved and tinted, and draws the layer over it; the pair then
  blends into the frame with the layer's blend mode, as After Effects'
  Drop Shadow effect does. So a rounded mask casts a rounded shadow, a
  compound clip casts one shadow for everything inside it, a motion-
  blurred layer casts a blurred one, and the layer's opacity fades its
  shadow with it.
- The shadow is not a separate layer in the plan: one more full-screen
  pass and a pyramid, only for clips that have one. A canvas fill (the
  clip's own blurred copy behind it) casts none.
- `set_shadow` (color, blur, x, y, opacity, off, at) and the Shadow
  section of the Video tab run the same command.

### Perspective tilt, for the same windows

Product films also turn their floating windows in depth. A picture's
`transform.rotateX` and `transform.rotateY` (degrees, CSS's rotateX and
rotateY, composed rotateY, rotateX, then the turn in the plane) and
`transform.perspective` (the camera's distance, pixels at 1080p, absent
2000, looking at the canvas center as a real camera does) tilt it. A flat
picture stays flat, so its quad maps to the screen by a homography
(`lib/tilt.ts` tiltMatrix): the layer's matrix becomes projective and
the vertex shader passes its third row as w, so the GPU divides and
interpolates the picture perspective-correctly. An untilted matrix's
third row is (0, 0, 1), so w is exactly 1 and every older picture draws
as before (the render fingerprint is unchanged). The tilt is applied
before the shadow, so a tilted window's shadow is tilted too. `set_tilt`
and the Transform section's Tilt X and Tilt Y set it.

## Consequences

- A tilted picture's edge mode (mirror, repeat) draws no copies; the
  copies' extent is solved for flat maps (a ponytail note in the
  compositor). Motion blur samples the move, not a keyed tilt's turn.
  The viewer's handles show the untilted box.
- The shadow lives inside the layer's canvas-sized buffer: a shadow that
  falls past the canvas edge is cut there, and the blurred picture's edge
  repeats past it, as blurs do.
- Titles now have two shadows: `style.shadow` (around the letters, under
  their outline) and the clip's `shadow` (cast by the whole title, its box
  included). The command description says which is which.
- Verified in the real engine: a half-size compound window with a rounded
  mask over gray casts a shadow whose edge sits at the offset, soft over
  the asked sigma, with rounded corners, and none above the window.
