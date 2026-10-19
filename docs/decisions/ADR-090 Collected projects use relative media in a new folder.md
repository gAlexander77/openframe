# ADR-090 Collected projects use relative media in a new folder

Status: implemented; Rust execution and native validation pending.

Collection is a fixed Rust operation. The destination comes only from the
native folder dialog. A new uniquely named subfolder prevents overwrites;
only validated absolute regular-file sources are copied. Each distinct
source path gets one generated filename, avoiding basename collisions.
Proxy, LUT and nested cutout locations are included. JSON is written after
the media, and reported errors remove only the newly created subfolder.
Progress is reported per completed file through a Tauri channel.

Opening JSON validates the file path and size in Rust, then normalizes the
project in the shared frontend. Relative locations resolve beside the
project file. A fresh project identity prevents overwriting a saved project
with the same id. The existing navigation/save guard protects current edits.
Missing sources are left available for the existing relink workflow.

The browser downloads JSON only and states that media remains in its
profile. A browser file picker can import JSON; filesystem path automation
and the collect_project command are explicitly desktop only.
