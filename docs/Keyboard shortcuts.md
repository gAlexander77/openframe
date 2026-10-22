# Keyboard shortcuts

The default keys, grouped as the app's shortcuts panel groups them. The
panel (Help > Keyboard shortcuts, or the keyboard button in the title bar)
is the source of truth: it shows your own changes, and any row can be
changed there (press the new keys; a key another action uses is named and
moves only on Replace). Changes are kept per viewer and survive restarts.

The defaults are CapCut desktop's wherever CapCut has the action, and
Premiere Pro's where it does not. On macOS, Ctrl is Cmd and Alt is Option.
Written from `src/lib/keymap.ts` and `src/components/ShortcutsDialog.tsx`
on 2026-10-18; when they change, change this page with them.

## Playback

| Action | Keys |
|---|---|
| Play / pause | `Space` |
| Previous frame | `Left` |
| Next frame | `Right` |
| Back 10 frames | `Shift+Left` |
| Forward 10 frames | `Shift+Right` |
| Previous edit point | `Up` |
| Next edit point | `Down` |
| Go to start | `Home` |
| Go to end | `End` |
| Shuttle backward | `J` |
| Shuttle stop | `K` |
| Shuttle forward | `L` |
| Loop playback | `Ctrl+L` |
| Play in to out | `Ctrl+Shift+Space` |
| Toggle compare | `Alt+Shift+C` |
| Full-screen preview | `Ctrl+Shift+F` |

## Editing

| Action | Keys |
|---|---|
| Split | `Ctrl+B` or `Ctrl+K` |
| Split all tracks | `Ctrl+Shift+B` |
| Delete left | `Q` |
| Delete right | `W` |
| Delete | `Delete` or `Backspace` |
| Ripple delete | `Shift+Delete` or `Shift+Backspace` |
| Duplicate | `Ctrl+D` |
| Copy | `Ctrl+C` |
| Cut | `Ctrl+X` |
| Paste | `Ctrl+V` |
| Freeze frame | `Alt+F` |
| Extract audio | `Ctrl+Shift+S` |
| Create compound clip | `Alt+G` |
| Break apart compound clip | `Alt+Shift+G` |
| Activate / deactivate clip | `V` |
| Edit text | `Enter` |
| Nudge clips one frame left | `Alt+Left` |
| Nudge clips one frame right | `Alt+Right` |
| Nudge clips five frames left | `Alt+Shift+Left` |
| Nudge clips five frames right | `Alt+Shift+Right` |
| Group clips | `Ctrl+G` |
| Ungroup clips | `Ctrl+Shift+G` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` or `Ctrl+Y` |

## Selection and tools

| Action | Keys |
|---|---|
| Select all | `Ctrl+A` |
| Deselect | `Escape` |
| Select clips to the left | `[` |
| Select clips to the right | `]` |
| Selection tool | `A` |
| Split tool | `B` or `C` |
| Ripple trim tool | `T` |
| Roll tool | `R` |
| Slip tool | `Y` |
| Slide tool | `U` |
| Rate stretch tool | `Shift+R` |

## Timeline

| Action | Keys |
|---|---|
| Main track magnet | `P` |
| Auto snapping | `N` |
| Linkage | `` ` `` |
| Preview axis | `S` |
| Keyframe animation | `Alt+K` |
| Zoom in | `Ctrl+=` or `=` |
| Zoom out | `Ctrl+-` or `-` |
| Zoom to fit | `Shift+Z` |
| Add marker | `M` |
| Next marker | `Shift+M` |
| Previous marker | `Alt+Shift+M` |
| Mark in | `I` |
| Mark out | `O` |
| Set range to clip | `Shift+X` |
| Clear range | `Alt+X` |
| Lift in to out | `;` |
| Extract in to out | `'` |
| Insert source at playhead | `,` |
| Overwrite source at playhead | `.` |

## Project

| Action | Keys |
|---|---|
| New project | `Ctrl+N` |
| Open project | `Ctrl+O` |
| Save project | `Ctrl+S` |
| Import media | `Ctrl+I` |
| Export | `Ctrl+E` |
| Save frame as PNG | `Ctrl+Shift+E` |
| Keyboard shortcuts | `Ctrl+/` |
| Preferences | `Ctrl+,` |

## Elsewhere

- **The viewer:** after clicking the viewer, the arrow keys nudge the
  selected pictures 1 px (with Shift, 10 px); elsewhere they step frames.
  Ctrl with the mouse wheel zooms the viewer at the pointer.
- **The timeline:** Tab lands on the selected clip (or the first), the
  arrows move between clips and tracks, and every edit key acts on the
  focused clip. Ctrl with the mouse wheel zooms at the cursor.
- **Buttons and switches:** Space presses a button, switch, checkbox,
  tab or menu item you reached with Tab or the arrow keys, and Enter
  presses a focused button whichever way it got the focus. After a mouse
  click leaves a button focused, Space still plays, as it does from the
  timeline, the viewer and a slider.
- **Typing on the canvas:** Escape or a click outside finishes; Enter
  breaks a title's line, and in a caption it finishes (Ctrl+Enter breaks
  the line). Shortcuts stay off while typing.
- **Selected keyframes** take Delete, Copy, Paste and Escape before clips
  do.
- **Rotation dial:** focused arrows step one degree, or ten with Shift;
  Shift while dragging snaps to 15 degrees. Double-click resets. These
  are local control keys, like the numeric fields' arrows.
- **Pen mask editor:** Delete removes the selected anchor while the mask
  editor has focus; Alt-click toggles a point between smooth and corner.
