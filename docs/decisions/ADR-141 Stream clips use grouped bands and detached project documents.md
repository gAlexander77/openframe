# ADR-141: Stream clips use grouped bands and detached project documents

**Date:** 2026-10-21. **Status:** accepted.

## Context

One long VOD supplies many shorts with the same facecam, gameplay,
captions and streamer credit. Navigation during batch work would replace
the editor's undo history and risk autosaving a temporary project.

## Decision

`apply_stream_layout` crops two ordinary video clips into vertical bands,
compensating the source crop's center in their transforms. Gameplay owns
the sound; the facecam is muted. An optional border is an editable shape.
Optional, validated `Clip.streamLayout` identifies the parts; the existing
group ID links them. Stream groups trim and split atomically, including
locked members. A split gives the right halves a fresh group. Ungrouping
allows independent timing again. Other groups keep their current behavior.

`create_clips` validates a pure plan before saving detached documents.
The shared UI/tool builder adds framing, timed pop captions, a brand hook,
dialog normalization and, when supplied, streamer credit. Credit appends
a two-second end card; reported lengths include it. Transcription hears
only requested source windows through the existing serialized cache.
Media and playback proxy paths are shared, never copied.

`export_projects` snapshots saved documents and renders sequentially under
the existing export lock, using the versions path for additional shapes.
Quick social-short findings and measured loudness accompany each file;
partial results survive failures in `export_status`. Session-created IDs
provide the default batch. Filenames include IDs to distinguish equal names.
Neither operation opens its working documents or changes editor history.
JSON Schema unions validate `captions: false` and `border: "none"` explicitly.

## Consequences

Existing rendering, captions, inspection and versions consume ordinary
clips. Shared files must remain available to every saved clip project.
Speech-model failures stop creation and report projects already saved;
browser batch exports use save dialogs and cannot honor a desktop folder.
