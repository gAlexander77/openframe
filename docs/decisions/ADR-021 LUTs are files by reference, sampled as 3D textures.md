# ADR-021: LUTs are files by reference, sampled as 3D textures

- **Date**: 2026-10-14 · **Status**: accepted

## Context

A .cube LUT is a table, often 33³ or 65³ rows (36 K to 275 K lines,
1–9 MB of text). Users import them once and use them on many clips
([[CapCut desktop]] §3.8, [[Professional NLE features]] §6.4). Where the
table lives, and how the GPU reads it, decide whether projects stay small
and whether preview and export can disagree.

## Decision

- **Stored by reference.** The project gets a `luts` list of
  `{ id, name, src, kind, size }`; a clip's `adjust.lut` names an id. The
  file stays where the platform keeps imported files (`adoptFiles` into
  OPFS on the web, a path on desktop) and is read with `blobFor`, exactly
  like media. Embedding the table would put megabytes into every autosave
  and every undo snapshot.
- **Parsed once, shared.** `src/engine/luts.ts` caches parsed tables by
  `src`. Importing primes it; `resolveSources` awaits every LUT a frame
  uses before the synchronous compositor pass, so preview and export (both
  go through `resolveSources` → `compositor.render`) see the same table. A
  LUT that cannot load renders as no LUT with one warning.
- **3D tables are `RGB16F` 3D textures** sampled at texel centers
  (`v·(N−1)/N + 0.5/N`) with hardware trilinear filtering; 1D tables are
  an N×1 strip (resampled to ≤ 4096 texels). Half floats keep about
  11 bits, past what 8-bit output can show; `RGB16F` is filterable in core
  WebGL2 where 32-bit floats need an extension.
- **Intensity** mixes the LUT's output with its input, as CapCut and
  Lumetri's Creative Look do. The LUT runs first in the grade
  ([[ADR-020 The grade lives in adjust, in Lumetri's order]]).
- A `sampler3D` may never share a texture unit with a `sampler2D`, so the
  grade owns fixed units (curves 1, 1D LUT 2, 3D LUT 3) and binds 1×1
  stand-ins when a part is off.

## Consequences

Measured in Edge: an identity 33³ LUT changes no channel by more than 1
of 255; a 17³ inversion is exact to 1. `ponytail:` trilinear only;
tetrahedral interpolation (VEGAS, Resolve) gives cleaner neutral ramps and
is a shader change when someone sees the difference. LUTs are per project;
a cross-project LUT library ("My LUTs") is a platform list away.
