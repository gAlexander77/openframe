# ADR-145: The shot log is a second transcript written locally

**Date:** 2026-10-23. **Status:** accepted.

## Context

The owner wants an agent given footage to understand what happens on screen,
what changes, where to cut and how to join pieces, beside the speech transcript.
Nothing for the user to install or start; footage stays on this computer.
Round 7 measured high WebView2 memory use (ADR-144), so vision inference must
not add another large model to the webview.

## Decision

FFmpeg measures shots and sound in one decode. A separate app-owned
llama.cpp b11529 process uses Vulkan (Metal on macOS), preferring a discrete
GPU, with Qwen3-VL-4B-Instruct Q4_K_M and its Q8 vision encoder (Apache-2.0).
The pinned runtime and model download on first use, about 2.9 GB; status
reports the actual bytes missing. This fits the lead's 8 GB laptop GPU.
The lead measured about 8 s to load, 25 s first-request warm-up, then
3–5 s per one-to-three-frame description and about 43 generated tokens/s.
Every schema string has maxLength; short fields precede description to
prevent the observed repetitive generation exhausting the token limit.
Split long shots evenly into moments (8 s default); sample one or three
768 px frames. Describe every eighth moment across the file first, then
midpoints and the rest (ADR-142's coverage lesson). Save every ten and on
finish/cancel; resume undescribed moments. Disk logs are truth, with a
validated version-1 format and an 8 MiB idle ByteLru, outside project undo.
Visible logs are borrowed and accounted for until the panel closes.
Reads reuse already-heard speech; they never start hearing. Join advice
names existing commands and explicit placement placeholders. The web build
has no describer and explains that these tools require the desktop app.

## Consequences

Descriptions are visual evidence, not ground truth; preview chosen frames
before cutting. Cancellation stops between native operations; an in-flight
prepare/ask/frames call has no cancel command in the contract. Downloads
remain on disk. Desktop end-to-end checks follow the Rust lane merge.
