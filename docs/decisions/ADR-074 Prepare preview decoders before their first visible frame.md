# ADR-074: Prepare preview decoders before their first visible frame

Status: accepted. Date: 2026-10-18.

A late in-point in a long-GOP source needs many frames decoded before its
first displayed frame. The old fixed 0.75-second preparation used the cut
rather than the earlier transition handle, then sought backward when the
transition began. First-use shader compilation compounded the stall.

Prepare the actual first source frame from the preceding keyframe using
the existing per-clip cursor. Estimate lead from source pixels, frame rate
and keyframe distance, then update throughput from completed decodes. Lead
is bounded to 0.75-5 seconds. Start one entry at a time, earliest first.
Warm compositor programs when the viewer attaches.

Admission uses 512 MiB for additional prepared entries: 42 RGBA-sized
frames per forward cursor conservatively account for the head and initial
mediabunny queue burst; reverse windows count against the same budget.
Oversized entries wait for on-demand playback. This is an admission estimate,
not a process-memory ceiling: playing cursors, the idle pool and codec-driver
surfaces are separate. The cursor owns its borrowed head; mediabunny closes
skipped samples and its queue, and cursor disposal closes the head.

The export plan and export cursor behavior are unchanged. Cuts inside an
already-playing compound remain a deliberate limitation. Starting playback
at a cut offers no lead; slow decoding can still miss that deadline.

Verification: a 10-second 1080p30 H.264 fixture with GOP 240, a source-7-second
in-point and a 10-frame zoom punch. On headless Edge, the original first
transition pass had a 628 ms gap, 19 missed frames in the cut window and
2/10 transition frames drawn. The inherited implementation reduced this to
36 ms, zero missed frames and 10/10 transition frames. The hard cut was
already smooth in this run (36 ms before, 39 ms after). Measurements are
machine-load dependent and do not validate desktop WebView2 performance.
Unit tests cover lead, transition handles and budget admission. The playback,
framecode and export drives check playback and exact source/output frames.
