# ADR-029: Headless rendering reuses the app

- **Date**: 2026-10-14 · **Status**: accepted

## Context

The owner wants pipelines that produce finished videos without a person:
an agent writes a project, something turns it into a file. Remotion renders
with headless Chromium; JSON-to-video services render on their servers. We
have no server ([[ADR-003 Desktop first, one build, a platform seam]]), and
a second renderer would drift from what the editor shows.

## Decision

`video-editor --render project.json --out video.mp4 [--format mp4|mov|webm|mkv]
[--resolution 480p|720p|1080p|2k|4k] [--quality lower|recommended|higher]`
starts the desktop app with its window hidden. Rust reads the project and
makes relative media paths absolute against the project's folder (so a
project and its media travel together); the webview normalizes the project
and runs **the same `exportProject`** as the export dialog, writing straight
to `--out` through the positional export job — only the path from the
command line can be opened this way. Progress goes to stdout as JSON lines
(`start`, `progress`, `done`/`error`); the exit code is 0 on success, 1 on
a failed render, 2 on bad arguments. A windows-subsystem build attaches to
the parent console so the lines show up when run by hand.

## Consequences

What renders headless is pixel-for-pixel what the editor exports: the
example in `scripts/render-example/` (a 6 s timeline with a title, a
dissolve and audio) rendered in 1.4 s, 180 frames at 1280x720 H.264 + AAC,
and the framecode check found every frame showing the source frame the
timeline asks for. A hidden window still needs a desktop session (it is a
webview); a true server-side renderer stays out of scope.
