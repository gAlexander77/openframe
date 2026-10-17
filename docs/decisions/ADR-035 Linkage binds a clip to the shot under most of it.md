# ADR-035: Linkage binds a clip to the shot under most of it

- **Date**: 2026-10-14 · **Status**: accepted

## Context

CapCut's linkage keeps the layers above the main track on their shots when
main clips ripple or reorder ([[CapCut desktop]] §2.4). Its help pages name
what links (text, stickers, effects, filters, overlays: whatever sits on a
main clip) but not the rule for "sits on"; community answers add that
sound placed on a shot follows it too. Our first rule bound a clip to the
main clip its **start** fell in, so a music bed from 00:00 under three
shots belonged to the first one: dragging the second shot to the front
moved the music 6 s and the video started silent ([[UX audit 2026-10-14]]
UX-14).

## Decision

A clip on any other track sits on the main-track clip that covers **more
than half of it**, judged on the project before the edit, and moves by the
same amount as that clip (`settle` in `src/lib/project/ops.ts`). Kind does
not matter: a title, sticker, overlay or sound effect on one shot follows
it, even if it starts a few frames into the previous shot; a music bed,
voiceover, logo or adjustment layer spanning several shots sits on none of
them and stays put. Exactly half on two shots counts as neither. The old
guards stay: clips the edit moved itself, locked tracks, and moves that
would collide or go before 00:00 are left alone.

## Consequences

The rule needs no per-clip link data in the project file and is the same
for every track kind, so agents and the UI get it from `settle` alone.
`ponytail:` a bed that happens to lie mostly on one long shot still
follows it; an explicit link or unlink per clip (CapCut's Linkage
dropdown, unverified) is the upgrade path if that bites.
