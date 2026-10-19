# ADR-088: Layout and group geometry use canvas pixels

Accepted, 2026-10-19.

Compute layout cells in canvas pixels. Gap and margin use the shorter canvas
side, giving equal physical gutters on portrait and landscape projects.
Cover fitting writes symmetric source crop and uniform scale. PIP keeps the
first picture full frame. Inputs must share some time and be unlocked visuals.

A layout explicitly replaces transform/crop/mask keys and clip animations,
rather than letting stale keys override its cells. Optional borders are ordinary
editable shape layers, grouped with their pictures. Stack input pictures in
order to ensure PIP overlays remain above their main picture. One edit contains
all changes, including border creation and entrance keys.

Group transforms rotate and scale member anchor positions in canvas pixels
about the union of their resting bounds. This preserves cropped and anchored
layouts on non-square canvases. Each member uses its own relative keyframe
time. Explicit `at` creates transform keys; otherwise existing keyed paths get
keys and static paths change directly. The viewer uses the same transform math.
