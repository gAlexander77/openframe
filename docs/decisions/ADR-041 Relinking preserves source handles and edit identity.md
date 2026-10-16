# ADR-041: Relinking preserves source handles and edit identity

**Date:** 2026-10-16. **Status:** accepted.

## Context

The owner approved recovery of missing media. [Premiere's relinking workflow](https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/relink-offline-clips.html)
uses the previous path to help locate a replacement. A matching filename alone
does not establish that two files contain the same footage.

## Decision

Keep the asset ID, user label and clip document; replace only source metadata.
Validate media kind, required streams and the entire original duration, then
ask the editor to confirm the replacement path. Keeping all original source
handles protects later trims, reversed footage and speed ramps without
silently clamping edits. Dimensions/frame rates can change; the existing
canvas and source-seconds mapping continue to apply.

Use an undoable metadata edit, without magnetic timeline compaction. Capture
the document session before opening the picker and reject stale source paths.
Key decoder cursors by source as well as clip identity. Do not dispose shared
media inputs while another cursor or export might still own their samples.

## Consequences

One file is relinked at a time, including every use on locked/hidden tracks:
this repairs their source, not their timing. No saved format migration is
needed. Automatic directory matching, original/proxy health reports and
timecode alignment remain future extensions. Equal metadata cannot identify
content; the user reviews the chosen file. Full validation evidence is in
[[Development pass 2026-10-16]].
