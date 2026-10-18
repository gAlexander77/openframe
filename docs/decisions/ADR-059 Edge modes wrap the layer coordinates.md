# ADR-059: Edge modes wrap the layer coordinates

**Date:** 2026-10-18. **Status:** accepted.

## Context

A picture that is shaken, spun or zoomed out uncovers the canvas behind
it. Editors fix that with After Effects' Motion Tile (Mirror Edges) or the
"mirror edges" option of shake and zoom plugins, which fill the canvas with
reflected copies of the picture, seamless at the joins. CapCut's Canvas
fill blurs a still copy behind the clip, which does not move with it.

## Decision

- **A per-clip `edge`: `mirror` or `repeat`** (absent: nothing), set with
  `set_edge_mode`.
- **The layer's quad grows to the canvas and the shader wraps.** With an
  edge mode, the compositor inverts the layer's placement to find the span
  of layer units that covers every canvas corner and draws that quad
  (`u_extent`); the fragment shader wraps the layer coordinate (mirror:
  `1 - |mod(u, 2) - 1|`, repeat: `fract(u)`) before the crop, the
  container rotation and the texture lookup, and before the mask and
  vignette, so every copy is the same picture. The lookup that the vertex
  shader did moved into the fragment shader for this, as one small matrix
  uniform (`u_uv`).
- It works per sample, so a motion-blurred, shaken picture blurs its
  mirrored copies too.

## Consequences

Mirror is seamless; repeat shows the picture's own edge at each join, as
tiling does. A shape with an edge mode tiles the shape. Ordinary layers
keep drawing their own quad (extent 0..1) and pixels came out identical
before and after on rotated phone footage and compound clips.
