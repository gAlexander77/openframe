# ADR-146: The shot log supports highlight ranking and paired analysis

**Date:** 2026-10-23. **Status:** accepted.

## Context

The landing log took 38 minutes. Literal search missed related editing words;
sound ranking lacked visible reactions. Hearing picture and speech separately
required two calls, and fixed shots filled the panel with repetitive rows.

## Decision

Run two descriptions over the existing coarse-to-fine order. Count finished
valid moments, save every ten, stop admission on cancel/error, and drain both
workers before final save or resume. Serialize saves to preserve arrival order.
Use Y1's overall download fraction/bytes as one progress bar.

find_highlights reads an existing log without inference: picture weight 0.25,
against audio 0.5, speech 0.1, chat 0.25 and scenes 0.05. Per moment, event
stems in action/mood contribute 0.7; newly appearing/changed readable text,
a changed people count and motion above twice the file median each add up
to 0.1. Motion must also exceed the median by 0.05. Normalize with the other
available weights. Sound leads; clocks, cuts and layout changes stay small.
Reasons name the evidence and signals includes shot_log, including partial logs.

Search uses nine small editing synonym families at half direct-match weight;
quoted phrases still match literally and matched_words reports matching stems.
analyze_footage speech defaults false and uses the existing bounded transcript
hearing; the panel defaults Include speech on for videos under 20 minutes.
No-audio logs carry optional has_audio false; absent preserves older behavior.
The panel shares brief grouping, opens explicit source marks, and loads visible
160px middle-frame thumbnails into an 8 MiB ByteLru with visible borrows.

## Consequences

No new dependency or project field. Thumbnail owners clear with the project;
the web has none. OCR guards remove multiword object prose but can omit a
lowercase sentence caption. Ranking remains heuristic; preview candidates.
The lead measures the two NASA reactions against the top six after lane merge.
