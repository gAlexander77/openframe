# Media organization

**Reviewed:** 2026-10-15. **Scope:** finding and reusing imported media.

Premiere offers metadata-based list views and sorting. Its documented
columns include source duration, frame dimensions, and video/audio usage
counts. These are useful when thumbnails alone cannot distinguish many
similar shots. Sources: [Customize List View](https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/customize-list-view-in-project-panel.html)
and [List View columns](https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/list-view-columns.html),
both dated January 7, 2026 on Adobe's site.

## Applied to OpenFrame

Keep the existing thumbnail grid, add a compact list suited to our library
panel, and show existing source metadata without reprobes. Search combines
with type and used/unused filters; name and duration sorts help compare
shots. A list-row usage count selects those clips and seeks their earliest
start, connecting the library to the timeline. Used/unused updates on edits
and Undo. ADR-040 records the exact usage and session-state semantics.

This is a targeted organization improvement, not parity with Premiere's
bins, editable XMP columns or offline relinking. Folder bins, source-monitor
In/Out selection, relinking and project copies remain candidates. A prior
safety check reproduced lost edits during project saves; that was fixed
first (ADR-039) because reliable project storage matters before adding more
ways to organize work.

## Evidence

Five pure tests cover combined filters, natural name sorting, stable
duration sorting, unknown/still durations, immutable inputs, and references
on inactive tracks. Twenty-two `media-library` checks pass through isolated
headless Playwright MCP, including real fixture imports, usage selection,
Undo updates, list/grid add behavior, drag placement, keyboard activation,
tab/project transitions and fit at 1600×950 and 1100×680. Both screenshots
were inspected. Native desktop input and large-library performance remain
unmeasured; no comparative speed or product-parity claim is implied.
