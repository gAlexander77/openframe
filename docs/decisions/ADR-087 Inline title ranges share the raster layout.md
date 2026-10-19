# ADR-087: Inline title ranges share the raster layout

Accepted, 2026-10-19.

Store optional UTF-16 ranges on TextStyle. Normalize them to disjoint intervals,
merging fields in application order. A solid run color replaces a gradient.
Text replacement finds a common prefix and suffix and shifts or trims ranges.
Insertion strictly inside a range inherits it; boundary insertion stays outside.

Measure styled segments with their own font before wrapping. Split drawable
kinetic units at style boundaries while retaining the original unit pivot and
state. Alignment, checks and version export inherit this shared raster geometry.
The inspector word picker avoids requiring a live canvas selection.
