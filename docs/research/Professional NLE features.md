# Professional NLE features

Research note, 2026-10-13. What "pro depth" means in VEGAS Pro, Premiere and
DaVinci Resolve, written precisely enough to implement without re-researching.
The UX baseline is CapCut ([[CapCut desktop]]). This note is about the depth
underneath it.

- **Versions surveyed:** Adobe Premiere 26.x. The product was renamed from
  "Premiere Pro" with 26.0 in January 2026, and 26.3 shipped in June 2026.
  After Effects is covered where its keyframe model is the reference. VEGAS
  Pro 2026: Boris FX acquired VEGAS, SOUND FORGE and ACID from MAGIX in March
  2026, and the help is now hosted by Boris FX. DaVinci Resolve 21 was
  announced at NAB in April 2026 and has had its full release since.
- **Abbreviations:** PR = Premiere, AE = After Effects, VG = VEGAS Pro,
  DR = DaVinci Resolve. Shortcuts are **Windows defaults**. "—" means there's
  no default key (menu or mouse only).
- **Related:** [[Web media engine]] · [[Tauri desktop media]] ·
  [[AI and automation]] · [[ADR-004 Timeline time is integer frames]].
- **Confidence:** VEGAS behavior and shortcuts come from the official VEGAS Pro
  2026 help. Premiere shortcuts and formats come from Adobe's help pages.
  Resolve codecs come from Blackmagic's codec PDF (July 2025), and Resolve
  shortcuts from a published keymap reference. Items marked **(verify)** are
  from domain knowledge and should be checked in the app before we copy them
  exactly.

---

## 1. Editing model

### 1.1 Timeline paradigms

| Aspect | Premiere | VEGAS Pro | Resolve (Edit page) | CapCut (for contrast) |
|---|---|---|---|---|
| Model | Track-based. V1..Vn and A1..An. Higher V tracks composite over lower ones | Track-based. Each track holds **events**, and video and audio tracks can be ordered freely | Track-based. The Cut page adds a semi-magnetic "source tape" and sync bin | Magnetic main track plus free overlay tracks |
| Container | **Sequence** (many per project) | **Project/timeline** (one per .veg; nested timelines are separate .veg files) | **Timeline** (many per project) | Draft |
| Clip unit | Clip instance → master clip → media. Subclips are master clips with In/Out | Event → **takes** (alternate media per event) → media | Clip → media pool item | Segment |
| Overlap on the same track | Not allowed. Edits overwrite or are blocked | **Allowed: overlap = crossfade** (auto crossfades on) | Not allowed | Not allowed |
| Audio track types | Mono, stereo, 5.1, adaptive; submix tracks | Audio tracks plus **busses** (A–Z), assignable FX | Mono, stereo, 5.1, 7.1, adaptive (Fairlight) | Single type |
| Edit cursor | Playhead, moved by clicking the ruler | Edit cursor, set by **clicking anywhere in the timeline**. Dragging in an empty area creates a time selection | Playhead, moved by clicking the ruler | Playhead |
| First clip mismatch | Asks "Change sequence settings / Keep existing" | Project properties have **Match Media Settings** | Asks to change the project frame rate/resolution only for the first clip | Auto |

**Our model:** tracks with **no same-track overlap** (PR/DR semantics), plus
an optional VEGAS-style "overlap creates a crossfade" mode, which is a
power-user favorite. Clip positions are in integer frames (ADR-004).

### 1.2 Clip data model (what every clip instance needs)

| Field | Notes |
|---|---|
| `mediaRef` | Master clip or media ID. Subclips carry their own default In/Out |
| `trackId`, `start` (frames), `duration` (frames) | Timeline placement |
| `srcIn` (source seconds or source frames) | Slip changes this |
| `speed` (rational; sign means reverse) + `timeRemap` curve (optional) | Rate stretch changes `speed` and `duration` together |
| `linkGroupId` | Linked A/V. Selection and trims propagate unless "linked selection" is off or Alt is held |
| `groupId` | User grouping (PR Ctrl+G, VG G), separate from linking |
| `enabled` | PR Shift+E, DR D. A disabled clip renders as transparent or silent but stays in place |
| `effects[]`, `intrinsic{transform, opacity, volume, pan}` | Intrinsic properties are always present (PR "fixed effects") |
| `labelColor`, `name`, `markers[]` | Clip markers live in source time and move with slips |
| `fades{in, out, curve}` | Fade handles (DR/VG) |

**Out-of-sync badge:** for linked V/A, `offset = (startV − srcInV·fps) −
(startA − srcInA·fps)`. PR and DR draw a red "±N" frames badge on both
clips. DR's right-click "Slip into place" / "Move into place" fixes it.

### 1.3 Sequences, nesting, compound clips

| | Premiere | VEGAS | Resolve |
|---|---|---|---|
| Nest selection | Clip ▸ **Nest…**. A nested sequence is a clip whose source is a sequence. Edits inside propagate everywhere | **Create Nested Timeline** (Alt+C), Open nested (Alt+N), Open parent (Alt+P). It is a separate .veg file and is edited in the same window | **New Compound Clip** (stored in the media pool, "Decompose in Place" undoes it). **Nested timeline**: drag a timeline onto a timeline ("Decompose Using Clips Only") |
| Other | Make Subsequence (Shift+U): copy of the In/Out range as a new sequence. Reveal Nested Sequence (Ctrl+Shift+F). Toggle "insert sequences as nests or as individual clips" | Any .veg can be imported as media (a nested project) | **Fusion clip** (composite container). Multicam clip |
| Mismatch | The nest uses its own frame size, scaled per the media scaling setting | The nested project's properties apply | Per-timeline settings |

**Implement:** a sequence is a media source. Render it recursively, detect
cycles (a sequence can't contain itself directly or indirectly), and cache
renders of the nested sequence. Converting a selection to a nest replaces the
clips with one clip spanning their union. Decompose is the inverse.

**How the nest behaves, and what the open-source editors teach** (compound
clips, 2026-10):

- **Premiere:** the nest is a clip like any other: trim, slice, speed,
  effects, opacity and blend mode apply to the nest's *composited* picture,
  which is why editors nest two keyed layers to fade them out together.
  Trimming a nest only changes what is visible; the clips inside stay.
  Diagonal hatching at a nest's end means the nested sequence ended and
  nothing fills the frames, so trim it back. There is no "un-nest": undo or
  copy the clips out by hand.
- **Resolve:** compound clips live in the media pool; *Decompose in Place*
  puts the parts back where the compound sat. Effects on the compound itself
  are lost, as there is no clip left to carry them.
- **Kdenlive** (24.02): multiple sequences per project, a sequence used as a
  clip in another, "create sequence from selection". Every sequence shares
  the project's profile (frame rate, size), which keeps nesting simple.
- **Shotcut:** no editable nesting; *Open MLT XML As Clip* treats another
  project as a clip, edited only by opening that file. A nest you cannot
  open in place is what CapCut's reviewers call "limited".
- **OpenShot:** no nesting (a long-standing request).
- **Olive** (0.2): a sequence is footage and can be dropped into another;
  its node graph renders the inner sequence as an image the outer one
  composites (from its design notes, not verified here).

Lessons we took: one fps and canvas for every nested timeline (Kdenlive),
render the group to a texture so opacity and blend are right (Premiere,
Olive), Decompose in Place as the undo-compound (Resolve, CapCut), and
one undo history across every level, so undo never depends on which
timeline is open.

### 1.4 Linked A/V, grouping, J/L cuts

- **PR:** Link and Unlink (Ctrl+L). The *Linked Selection* toggle is on the
  timeline toolbar. **Alt+click** selects one side of a linked pair, and
  **Alt+drag an edge** trims only the video or only the audio (that is how
  J/L cuts are made).
- **DR:** Linked Selection toggle (Ctrl+Shift+L). Link Clips (Ctrl+Alt+L).
  Hold Alt while clicking or trimming to affect one side only.
- **VG:** events are *grouped* (G group, U ungroup, Ctrl+Shift+U ignore
  grouping). **Shift+drag an edge** = "L/J trim (ignores grouping)".
  Ctrl+Alt+Shift+drag = trim adjacent while ignoring grouping ("fast L and J
  cuts"). Numeric keypad Shift+1/3 = L/J trim by frames. VEGAS also has an
  *audio/video synchronization detection and repair* tool.

```
L-cut (A's audio runs under B's picture)     J-cut (B's audio starts under A's picture)
V1  AAAAAAAAAABBBBBBBBBB                      V1  AAAAAAAAAABBBBBBBBBB
A1  aaaaaaaaaaaaabbbbbbb                      A1  aaaaaaabbbbbbbbbbbbb
```

### 1.5 Track targeting, source patching, sync lock

| Concept | Premiere | Resolve | VEGAS |
|---|---|---|---|
| **Source patching** (which source track goes to which timeline track) | Left column of the track header (V1/A1 source indicators). Drag to repatch. Toggle all source video/audio (Ctrl+Alt+0 / Ctrl+Alt+9) | **Destination controls**: Alt+1..8 sets the video destination | No source monitor patching. Media goes to the focused or selected track |
| **Track targeting** (where paste, Add Edit, Q/W, Up/Down edit navigation, Match Frame and Lift/Extract act) | Right column, highlighted track name. Toggle all video/audio targets (Ctrl+0 / Ctrl+9) | **Auto Track Selector** (per-track button) | Selected events or tracks |
| **Sync lock** (which tracks shift during ripple edits) | Per-track sync-lock icon | Auto Track Selector doubles as sync lock: tracks with it on are split and rippled, tracks with it off are not | **Auto Ripple scope**: Affected tracks / + bus tracks, markers and regions / All tracks, markers and regions (press F, Ctrl+F or Ctrl+Shift+F after an edit) |
| Track lock | Per-track lock | Alt+Shift+1..8 | Track lock |

**Ripple rules to implement** (these match PR/DR in practice):
1. A ripple of Δ frames at time *t* on track *T* moves every item on *T* that
   starts at or after *t* by Δ.
2. For every **other sync-locked** track: items starting at or after *t* move
   by Δ.
   - Insert (Δ>0): an item that **spans t** is split at *t*, and the right
     half moves (PR insert behavior with sync lock on).
   - Removal (Δ<0): if a sync-locked track has media inside [t+Δ, t), the
     apps differ by operation. PR refuses to ripple-delete a *gap* unless
     it's empty on every sync-locked track **(verify edge cases)**. Our
     recommendation: block and flash the conflicting clip, with a modifier to
     "remove range from all sync-locked tracks."
3. Locked tracks never change. Non-sync-locked tracks never move, so they
   drift out of sync on purpose.
4. Rippling sequence markers is a scope choice: VG makes it explicit (F =
   affected tracks only, Ctrl+F also markers/regions/bus envelopes, Ctrl+Shift+F
   everything). PR and DR move sequence markers with ripples in most cases
   **(verify)**. We expose "Ripple markers" as an option, on by default.

### 1.6 Source monitor, three- and four-point editing

- **Points:** source In/Out (S-In, S-Out) and record or sequence In/Out
  (R-In, R-Out). Any **3** define an edit, and the 4th is computed:
  - S-In + S-Out + R-In → duration = S-Out − S-In, placed at R-In (the
    common case).
  - S-In + R-In + R-Out → duration comes from the record side.
  - S-Out + R-In + R-Out, or S-Out + R-Out → **backtimed** edit: the clip
    *ends* at R-Out.
  - No record marks: R-In = the playhead. No source marks: the whole clip
    from the source playhead (PR) or from the clip start **(verify)**.
- **Four-point** (all set, durations differ). PR shows a *Fit Clip* dialog:
  Change Clip Speed (Fit to Fill), Ignore Source In, Ignore Source Out,
  Ignore Sequence In, or Ignore Sequence Out. DR has a dedicated **Fit to
  Fill** (Shift+F11) that retimes the clip.
- **Edit types:**

| Edit | PR | DR | VG | Effect |
|---|---|---|---|---|
| Insert | `,` | F9 | Trimmer: A ("add media from cursor"), Shift+A ("to cursor"). Ctrl+Shift+V paste insert | Splits at R-In and pushes everything downstream (sync-locked tracks too). Duration grows |
| Overwrite | `.` | F10 | Drop or paste onto events | Replaces the range. Duration unchanged unless past the end |
| Replace | Clip ▸ Replace With Clip ▸ From Source Monitor (Alt+drag onto a clip; no default key) | F11 | — | Swaps the clip under the playhead, aligning the source playhead frame to the timeline playhead frame (sync point) |
| Fit to Fill | Via the 4-point dialog | Shift+F11 | — | Retimes the source to fill the record range |
| Place on Top | — | F12 | — | Puts the clip on the first free track above at the playhead |
| Append at End | — | Shift+F12 | — | Adds after the last clip |
| Ripple Overwrite | — | Shift+F10 | — | Replaces a clip and ripples the duration difference |

- **DR edit overlay:** dragging a clip onto the timeline viewer shows big
  targets: Insert / Overwrite / Replace / Place on Top / Append / Ripple
  Overwrite / Fit to Fill. It's very discoverable, so copy it.
- **Timeline drag modifiers:** PR plain drag = overwrite, **Ctrl+drag =
  insert**, **Ctrl+Alt+drag = rearrange** (extract and insert, swapping
  positions). DR **Ctrl+Shift+drag = swap/shuffle** **(verify)**. VG plain
  drag = move. Overlapping a neighbor creates a crossfade. With Auto Ripple
  on, downstream events ripple.

### 1.7 Insert vs. overwrite, lift vs. extract

Baseline used in all diagrams. **1 character = 1 frame.** Clips are 10
frames, and source ranges are inclusive. Every source has ≥10 frames of
unused media (handles) on both sides.

```
frame    0         1         2         3
         0123456789012345678901234567890
V1       AAAAAAAAAABBBBBBBBBBCCCCCCCCCC        A=100–109  B=200–209  C=300–309   seq=30
```

**Insert** X (500–504) at frame 13 (playhead inside B):
```
V1       AAAAAAAAAABBBXXXXXBBBBBBBCCCCCCCCCC   B→200–202 | X | B'→203–209, C→25–34   seq=35
A1       aaaaaaaaaabbb.....bbbbbbbcccccccccc   sync-locked A1 split and shifted (no audio under X)
```
**Overwrite** X at 13:
```
V1       AAAAAAAAAABBBXXXXXBBCCCCCCCCCC        B→200–202 | X 13–17 | B'→208–209   seq=30
```
**Lift** (PR `;`) with In=10, Out=19 on targeted tracks leaves a gap:
```
V1       AAAAAAAAAA..........CCCCCCCCCC        seq=30
```
**Extract** (PR `'`) removes the range and ripples it closed:
```
V1       AAAAAAAAAACCCCCCCCCC                  seq=20
```
- PR: Lift `;`, Extract `'` (they use the In/Out range on targeted tracks).
- DR: with In/Out marked, Backspace = delete leaving a gap and Delete or
  Shift+Backspace = ripple delete. Ripple Cut is Ctrl+Shift+X.
- VG: make a time selection, then Delete (lift). With Auto Ripple (Ctrl+L)
  on, or by pressing F afterward, it's an extract.

### 1.8 Multicam (pro must-have, P1)

- **PR:** Create Multi-Camera Source Sequence (sync by In points, Out points,
  timecode, clip markers or **audio**). Record by playing and pressing 1–9.
  Afterward the sequence is flattenable.
- **DR:** Multicam clip (sync by timecode, audio, In/Out or markers). The
  multicam viewer cuts with 1–9. There are modifiers to switch video only or
  audio only **(verify)**.
- **VG:** Ctrl+Shift+D enables multicamera editing. Events with multiple
  takes are created, 1–9 chooses a take, and **Ctrl+1–9 chooses with a
  crossfade**.

---

## 2. Trim tools, precisely defined

### 2.1 Summary

| Tool | PR | DR | VG | Clip src In/Out | Clip position | Neighbors | Sequence duration |
|---|---|---|---|---|---|---|---|
| **Trim** (regular / overwrite) | Selection V, drag edge | Selection A, drag edge | Normal tool, drag edge | One edge changes | Unchanged (head trim moves the start) | Unchanged. Leaves a gap. Extending is **blocked** by the neighbor in PR/DR, and **overlaps into a crossfade** in VG | Unchanged (or grows at the end) |
| **Ripple** | B (or Ctrl-modifier with Selection) | Trim mode T, drag edge | Auto Ripple Ctrl+L + trim (or press F after) | One edge changes | Downstream shifts by Δ | Downstream moves | Changes by Δ |
| **Roll** | N | T, drag the center of the edit | Ctrl+Alt+drag edge ("trim adjacent"); Ctrl+Alt+drag over a crossfade = "slide crossfade" | A's Out and B's In change by the same Δ | Edit point moves | Both sides change | Unchanged |
| **Slip** | Y (Ctrl+Alt+←/→ ±1 frame) | T, drag the clip body (lower part) | Alt+drag inside the event (Alt+Numpad 1/3) | In and Out both shift by Δ | Unchanged | Unchanged | Unchanged |
| **Slide** | U (Alt+, / Alt+. ±1 frame) | T, drag the clip **name bar** (or S slide mode) | No direct equivalent (see VG "slide" below) | Unchanged | Moves by Δ | Previous Out and next In adjust by Δ | Unchanged |
| **Rate stretch** | R | Ctrl+R retime handles; R speed dialog | Ctrl+drag edge (time stretch/compress) | Unchanged (source range constant) | One edge moves | PR: needs empty space; DR/PR dialogs can ripple | Unchanged or ripples |
| **Razor / blade** | C (tool), Ctrl+K at playhead on targeted tracks, Ctrl+Shift+K all tracks | B (tool), Ctrl+B or Ctrl+`\` at playhead | S at cursor (selected events, or all under the cursor) | Splits into two with contiguous source ranges ("through edit") | — | — | Unchanged |
| **Ripple delete** | Shift+Delete (Alt+Backspace in timeline) | Delete / Shift+Backspace | Delete with Auto Ripple | Clip removed | Downstream shifts | Moves | Shrinks |
| **Close gap** | Select gap + Delete; Sequence ▸ Close Gap | Edit ▸ Delete Gaps | Edit ▸ **Close gaps** (selected events, or the whole track) | — | Shifts | Moves | Shrinks |
| **Extend edit** | E (selected edit point to playhead) | E | — (trim to cursor Alt+[ / Alt+]) | Roll-type | — | Yes | Unchanged |
| **Ripple trim to playhead** | Q previous edit / W next edit | Ctrl+Shift+[ / Ctrl+Shift+] | Alt+[ / Alt+] with Auto Ripple | One edge | Downstream shifts | — | Shrinks |
| **Trim to playhead (no ripple)** | Ctrl+Alt+Q / Ctrl+Alt+W | Shift+[ / Shift+] | Alt+[ / Alt+] | One edge | — | Leaves a gap | Unchanged |
| **Trim edit mode** | Shift+T, or double-click an edit (Trim Monitor) | T (+ W **dynamic trim** with JKL) | `[` / `]` edge-trimming mode, Numpad 5 **expanded edit mode** | Per type | — | — | — |

**Terminology trap:** VEGAS **"Slide"** (Ctrl+Alt+drag the middle of an
event) means *"move the event window over media that stays fixed on the
timeline."* Position and source In/Out both shift by Δ, and neighbors are
not adjusted, so it produces a gap or an overlap/crossfade. That is
effectively **slip + move**, *not* PR/DR slide. Show tool hints accordingly
in a VEGAS keymap preset.

### 2.2 Before/after diagrams

All of these start from the baseline in §1.7: `A=100–109 B=200–209
C=300–309`, sequence = 30.

**Regular trim:** B's Out −3. A gap is left.
```
before   AAAAAAAAAABBBBBBBBBBCCCCCCCCCC
after    AAAAAAAAAABBBBBBB...CCCCCCCCCC        B=200–206; gap 17–19; seq=30
```
**Regular trim outward:** B's Out +3. PR/DR block it at C. VEGAS overlaps
and creates a crossfade (`#`).
```
VEGAS    AAAAAAAAAABBBBBBBBBB###CCCCCCC        B=200–212 over C's first 3 frames (crossfade)
```
**Ripple trim, tail:** B's Out −3.
```
after    AAAAAAAAAABBBBBBBCCCCCCCCCC           B=200–206; C→17–26; seq=27
```
**Ripple trim, head:** B's In +3 (the clip start stays put and the content
starts later).
```
after    AAAAAAAAAABBBBBBBCCCCCCCCCC           B=203–209 at 10–16; C→17–26; seq=27
```
**Roll** the A|B edit +3:
```
after    AAAAAAAAAAAAABBBBBBBCCCCCCCCCC        A=100–112; B=203–209 at 13–19; seq=30
```
**Slip** B +3 (the content moves later inside a fixed window):
```
after    AAAAAAAAAABBBBBBBBBBCCCCCCCCCC        B=203–212 (same position and length)
```
**Slide** B +3 (PR/DR):
```
after    AAAAAAAAAAAAABBBBBBBBBBCCCCCCC        A=100–112; B=200–209 at 13–22; C=303–309 at 23–29; seq=30
```
**Rate stretch** B to 15 frames (66.67 %), rippled:
```
after    AAAAAAAAAABBBBBBBBBBBBBBBCCCCCCCCCC   B=200–209 shown over 15 frames; C→25–34; seq=35
```
**Razor** at 15:
```
after    AAAAAAAAAABBBBBbbbbbCCCCCCCCCC        B1=200–204 | B2=205–209 (through edit; PR can "Join Through Edits"; DR Join Clip Alt+\; VG "Heal")
```
**Ripple delete** B:
```
after    AAAAAAAAAACCCCCCCCCC                  seq=20
```
**Close gap** (from the regular-trim result):
```
before   AAAAAAAAAABBBBBBB...CCCCCCCCCC
after    AAAAAAAAAABBBBBBBCCCCCCCCCC           seq=27
```
**Q** (ripple trim previous edit to playhead), playhead at 13:
```
after    AAAAAAAAAABBBBBBBCCCCCCCCCC           B=203–209 at 10–16; playhead jumps to 10; seq=27
```
**W** (ripple trim next edit to playhead), playhead at 13:
```
after    AAAAAAAAAABBBCCCCCCCCCC               B=200–202; C→13–22; seq=23
```
**Extend edit E**, A|B edit selected, playhead at 13: same result as a roll
of +3.

**VEGAS slip-trim** (Alt+drag B's right edge +3, gap after B). The opposite
edge stays fixed and the media moves with the dragged edge, so the **last
frame stays pinned**:
```
before   ..........BBBBBBBBBB.....             B=200–209 at 10–19
after    ..........BBBBBBBBBBBBB..             B=197–209 at 10–22
```
**VEGAS "slide"** (Ctrl+Alt+drag B's body +3):
```
after    .............BBBBBBBBBB..             B=203–212 at 13–22 (window moved over timeline-fixed media)
```
**VEGAS overlap crossfade** (drag B left by 3 onto A, same track):
```
after    AAAAAAA###BBBBBBB                     ### = A 107–109 under B 200–202, crossfaded
```
**VEGAS split-trim** (Ctrl+Alt+Shift+drag): splits at the click and trims in
the drag direction ("eraser mode").

### 2.3 Trim mode UI (what makes it pro)

- **Two-up display:** the program monitor shows the outgoing frame (A's Out)
  on the left and the incoming frame (B's In) on the right during any trim.
  Slide shows **four-up** (prev Out, clip In, clip Out, next In). Slip shows
  the clip's In and Out frames. VEGAS shows split-screen previews of both
  sides in expanded edit mode.
- **Keyboard trimming:**

| Action | PR | DR | VG |
|---|---|---|---|
| ±1 frame | Ctrl+←/→ | `,` / `.` | Numpad 1/3 |
| ±many | Ctrl+Shift+←/→ (5) | Shift+, / Shift+. | — (Numpad 4/6 = ±1 pixel) |

- **Select an edit point:** PR uses the Ripple/Roll tool click, or Up/Down +
  Shift+T. DR uses **V** (select the nearest edit), **U** (cycle In side /
  Out side / both = ripple-left / ripple-right / roll), and Alt+E / Shift+E
  (video / audio point). VG uses `[` / `]` to step through edges, with a red
  bracket marking the active edge.
- **Dynamic JKL trimming:** DR presses W in Trim mode, then J/L plays and
  trims live, and K stops. PR Trim Monitor supports JKL trimming too. This is
  how editors find the exact frame.
- **Cursor color codes (PR):** red bracket = regular or roll, yellow bracket
  = ripple.
- **Numeric trims:** with an edit selected, type `+12` or `-1.00` and press
  Enter to trim by that many frames, or by 1 second (PR and DR). Without a
  selection the same input moves the playhead. A selected clip gets moved
  (nudged).

### 2.4 Nudge and move by keyboard

| Action | PR | DR | VG |
|---|---|---|---|
| Nudge clip ±1 frame | Alt+←/→ | `,` / `.` (clip selected) | Numpad 1/3 |
| Nudge ±5 frames | Alt+Shift+←/→ | Shift+, / Shift+. | — |
| Move to the track above/below | Alt+↑/↓ **(verify)** | Alt+↑/↓ | Numpad 8/2 |
| Slip selected ±1 frame | Ctrl+Alt+←/→ | `,`/`.` in Trim mode on the body | Alt+Numpad 1/3 |
| Slide selected ±1 frame | Alt+, / Alt+. | S mode + `,`/`.` | — |
| Time-stretch selected ±1 frame | — | — | Ctrl+Numpad 1/3 |

---

## 3. Playback and navigation

### 3.1 J/K/L shuttle

| Behavior | Premiere | Resolve | VEGAS |
|---|---|---|---|
| L / J | Play forward / reverse. **Each repeated press steps the speed up** | Same | Same ("scrub forward / reverse; press again to accelerate") |
| K | Stop | Stop | Pause |
| Hold K + tap L/J | **±1 frame** | ±1 frame | Emulates a shuttle knob: K+J turns left, K+L turns right |
| Hold K + hold L/J | Slow play forward / reverse | Slow play | Speed change while held |
| Shift+L / Shift+J | Ratchet speed up or down in fine increments (up to 5 presses) | **Fast** forward / reverse | — |
| Speed ceiling | Several steps (not documented) | Several steps | Set by **Preferences ▸ Editing ▸ JKL/shuttle speed** (users report a max of ~20× on "Fast") |
| Audio | Plays at speed. Pitch-preserve option ("maintain pitch while shuttling") **(verify)** | Plays at speed | Plays. High speeds may mute |

**Recommended semantics for us:**
- Speed ladder: ±1, 2, 4, 8, 16× (rates 0.25 and 0.5 via K+hold or Shift).
- Pressing the opposite key while moving drops straight to 1× in the new
  direction. Resolve's "reverses at double speed" behavior is a common user
  complaint.
- Releasing K+L/J pauses. Audio is pitch-corrected at ≤2× and muted above 4×.

### 3.2 Stepping, marks, go-to

| Action | PR | DR | VG |
|---|---|---|---|
| Frame step | ← / → | ← / → | Alt+← / Alt+→ |
| Big step | Shift+←/→ = **5 frames** | Shift+←/→ = **1 second** | Page Up / Page Down = grid marks |
| Previous / next edit | ↑ / ↓ (targeted tracks), Shift+↑/↓ (all tracks) | ↑ / ↓ | Ctrl+Alt+← / → (event edges, including fade edges) |
| Previous / next marker | Ctrl+Shift+M / Shift+M | Shift+↑ / Shift+↓ | Ctrl+← / Ctrl+→ |
| Previous / next keyframe | — | `[` / `]` | Ctrl+←/→ inside the keyframe controller |
| Start / end | Home / End | Home / End | Ctrl+Home / Ctrl+End (Home/End = selection or view edges) |
| Mark In / Out | I / O | I / O | I / O (sets the time selection) |
| Mark clip | X | X | Double-click the event |
| Mark selection | `/` | Shift+A | (time selection) |
| Clear In / Out / both | Ctrl+Shift+I / O / X | Alt+I / Alt+O / Alt+X | Backspace = restore previous selections |
| Go to In / Out | Shift+I / Shift+O | Shift+I / Shift+O | Home / End |
| Play In→Out | Ctrl+Shift+Space (Shift+Space with pre/post-roll) | Alt+/ **(verify)** | Space (plays the selection; Q toggles loop) |
| Play around | Shift+K | `/` (play around the current selection) | Numpad 0 (cursor preview) |
| Loop | Ctrl+L (monitor context) | Ctrl+/ | Q |

**Playhead idioms:**
- **VEGAS:** Space = play/**stop**, and stop returns the cursor to where
  playback started. Enter = play/**pause**, which leaves the cursor in place.
  Editors rely on "return to start".
- **PR/DR:** Space stops in place.
- **Auto-scroll during playback:** PR offers No Scroll / **Page Scroll**
  (default) / Smooth Scroll (fixed playhead). Offer all three.
- **Playhead and selection:** PR has "Selection follows playhead". DR and
  VG select on click. In PR and DR, clicking empty track space deselects,
  while in VG it moves the cursor.

### 3.3 Markers

| | Premiere | Resolve | VEGAS |
|---|---|---|---|
| Add | M (press M again to open the dialog) | M; Ctrl+M add and edit | M (marker), R (region), C (command marker), N / Shift+N (CD track/index) |
| Scope | Sequence markers and **clip markers** (stored in the master clip, shown on instances) | Timeline markers and clip markers; **Flags** (clip-level, colored, apply to all instances) | Timeline markers and regions; **media markers** (Trimmer, can be saved into the file) |
| Types | **Comment, Chapter, Segmentation, Web Link** | Color, name, notes, keywords, duration | Marker, region (range), command (URL, captions, metadata), CD markers |
| Colors | 8: green, red, purple, orange, yellow, white, blue, cyan | **16**: blue, cyan, green, yellow, red, pink, purple, fuchsia, rose, lavender, sky, mint, lemon, sand, cocoa, cream | Fixed per type |
| Duration | Yes (Alt-drag the marker, or set Duration) | Yes (Alt+drag, or set duration) | Regions |
| Navigation | Markers panel; next/prev | Marker index (Edit Index); Shift+↑/↓ | Numbered markers 1–99. Keys 0–9 jump directly |
| Export | Chapter markers → MP4/MOV chapters; markers CSV/HTML | Deliver can embed **chapters from markers of a chosen color**; EDL/CSV marker lists | "Save project markers in media file" on render **(verify)** |

**YouTube chapters** come from the description, not the file: the first
chapter at 00:00, ≥3 chapters, each ≥10 s. A "copy chapters as text" action
is cheap delight.

### 3.4 Snapping

| | PR | DR | VG |
|---|---|---|---|
| Toggle | S (works **mid-drag**) | N | F8. Shift+drag = temporary override |
| Targets | Clip edges, playhead, In/Out, markers, keyframes (Effect Controls) | Edits, playhead, markers, In/Out | Events, markers (Shift+F8), grid (Ctrl+F8), all events (Ctrl+Shift+F8) |
| Frame quantize | Always frame-accurate | Always | **Quantize to Frames** Alt+F8 (default on). Audio-only edits can be exempted |

**Implement:**
- Snap radius in **screen pixels** (~8–10 px), converted to frames at the
  current zoom.
- Priority: playhead > edit points > In/Out > markers > keyframes > grid.
- Draw a vertical snap line plus a tick on the ruler.
- Make "toggle snapping" pressable during a drag.

### 3.5 Timeline zoom and track height

| | PR | DR | VG |
|---|---|---|---|
| Zoom in / out | `=` / `-` | Ctrl+= / Ctrl+- | ↑ / ↓ (small steps), Ctrl+↑ / ↓ (large steps or to the selection); the wheel zooms |
| Zoom to fit | `\` | Shift+Z | — |
| Max zoom | Frame-level | Frame-level | Alt+↑ = one thumbnail per frame |
| Track heights | Ctrl+= / Ctrl+- (video), Alt+= / Alt+- (audio), Shift+scroll (all), Alt+scroll (one), Shift+- minimize all | Timeline view options (presets) | Ctrl+Shift+↑/↓ (all), `` ` `` minimize/restore, Ctrl+`` ` `` default |

**Rules:**
- Wheel zoom anchors at the mouse X. Keyboard zoom anchors at the playhead
  if it's visible, otherwise at the view center.
- Zoom range: 1 frame = up to ~100 px, down to the whole sequence plus 10 %.

### 3.6 Playback resolution, proxies, render cache

| | Premiere | Resolve | VEGAS |
|---|---|---|---|
| Playback resolution | **Full, 1/2, 1/4, 1/8, 1/16**, with separate playback and **paused** resolutions. High Quality Playback toggle | Timeline proxy resolution (Playback menu): **Choose automatically / Full / Half / Quarter**. Performance mode | **Preview quality: Draft / Preview / Good / Best × Auto / Full / Half / Quarter**. No deinterlacing in Draft/Preview |
| Proxies | Ingest settings (Copy / Transcode / **Create Proxies** / Copy + Create), with presets for ProRes Proxy, H.264 and CineForm. **Toggle Proxies** button. Proxies attach to the master clip. Export uses full-res unless "Use Proxies" is checked | **Generate Proxy Media** (or Blackmagic Proxy Generator; proxy folder relink). Proxy Handling: Prefer Proxies / Prefer Camera Originals / Disable All. **Optimized media** is a separate per-clip mezzanine | **Create Video Proxy** → `.sfvp0` beside the source (hidden in Project Media). **Auto-created for 4K**. Used only at Draft/Preview quality, never for render |
| Render / preview cache | **Render bar**: none = plays real-time; **yellow** = may need rendering; **red** = needs rendering; **green** = rendered preview exists. Enter = Render Effects In to Out. Sequence ▸ Delete Render Files | **Render cache: None / Smart / User**. A bar above the clips: **red** = needs caching, **blue** = cached. Smart caches heavy effects, transitions and Fusion. User cache adds per-clip "Render Cache Color Output" / "Fusion Output" | **Selectively prerender** (Shift+M) to files in the prerender folder. **Dynamic RAM preview** (Shift+B) |
| Feedback | Dropped-frame indicator (traffic light in the monitor) | FPS counter: green when real-time, red when dropping | Preview frame rate in the Video Preview status |

**Implement:**
- The playback resolution setting scales decode (where codecs allow
  reduced-resolution decode) **and** the compositing canvas.
- Track a "dropped frames" counter.
- Hash each render-cache segment by (clip IDs, effect params, source
  ranges), so an edit invalidates only the affected segments.

---

## 4. Keyframes and animation

### 4.1 Keyframeable properties (minimum set)

| Group | Premiere | Resolve (Inspector) | VEGAS |
|---|---|---|---|
| Transform | Motion: Position, Scale (uniform / W·H), Rotation, Anchor Point, Anti-flicker | Zoom X/Y, Position X/Y, Rotation Angle, Anchor Point, Pitch, Yaw, Flip H/V | **Event Pan/Crop** (frame rectangle, rotation, mask); **Track Motion** (2D/3D position, size, orientation, rotation, shadow, glow) |
| Crop | Crop effect | Cropping L/R/T/B + Softness | Pan/Crop (inverse model), Crop OFX |
| Composite | Opacity (+ mask), **Blend mode (not keyframeable)** | Composite Mode + Opacity | Composite level / opacity envelope; compositing mode per track |
| Time | Time Remapping ▸ Speed | Retime curve (speed and frame curves) | Velocity envelope (−100 % to +300 %) |
| Audio | Volume (clip), Channel Volume, Panner | Volume, Pan | Volume and pan envelopes (track and event), mute envelope |
| Effects | Any parameter with a stopwatch | Any parameter with the diamond button | Any OFX parameter via the keyframe controller or track keyframes |
| Other | — | Dynamic Zoom (start/end rects + ease) | Fade-to-color envelope, transition progress envelope |

### 4.2 Interpolation types

| Type | PR / AE | DR | VG | Math |
|---|---|---|---|---|
| Linear | Yes | Yes (default on the Edit page) | Linear | Lerp |
| Bezier (manual) | Bezier: independent in/out handles | Curve editor handles | **Manual** (spline handles in the Curves view), **Split Manual** (independent sides) | Cubic Bezier in (time, value) |
| Continuous Bezier | Yes: handles colinear, length free | — | — | Colinear tangents |
| Auto Bezier | Yes: smooth tangents computed from neighbors | — | **Smooth** | Catmull-Rom-like tangents |
| Ease In / Ease Out / Easy Ease | Temporal presets: speed 0, **influence 33.33 %** (AE F9 Easy Ease, Shift+F9 ease in, Ctrl+Shift+F9 ease out) | Ease In, Ease Out, Ease In and Out (right-click) | **Slow** (eases into the key), **Fast**, **Sharp** | Bezier with zero velocity at the key |
| Hold | Yes (step) | Fusion spline editor (step); Color page "static" keyframes **(verify Edit page)** | **Hold** | Step |
| Spatial interpolation | Separate from temporal: Linear / Bezier / Auto / Continuous **path** shapes | Fusion spline paths | Pan/Crop and Track Motion **Smoothness** slider: 0 = straight-line path, higher = curved path | 2D cubic path |
| Roving | AE: a key's time floats to give constant speed | — | — | Re-time keys by arc length |

VEGAS colors keyframes by curve type in the Pan/Crop and Track Motion lanes.
Its keyframe controller offers Lanes and Curves views, and Alt+dragging the
first or last selected keyframe re-spaces the selection evenly.

### 4.3 Bezier math (AE/PR "speed + influence" parameterization)

For a segment between keys *k* (t₀, v₀) and *k+1* (t₁, v₁), with
T = t₁ − t₀, outgoing speed s_out and influence p_out (0–1) on key *k*, and
incoming speed s_in and influence p_in on key *k+1*:

```
P0 = (t0,                 v0)
P1 = (t0 + p_out*T,       v0 + s_out * p_out*T)
P2 = (t1 - p_in*T,        v1 - s_in  * p_in*T)
P3 = (t1,                 v1)
```
Evaluating at time t:
1. Solve x(u) = t for u ∈ [0, 1] with Newton's method, falling back to
   bisection. x(u) is monotonic if the handles stay inside the segment, so
   clamp p ≤ 1.
2. Return y(u).

Other rules:
- **Easy Ease:** s = 0, p = 1/3.
- **Auto Bezier:** s = (v_{k+1} − v_{k−1}) / (t_{k+1} − t_{k−1}), with
  p = 1/3. At extremes, clamp to 0 to avoid overshoot (AE does this for
  auto-bezier at local extrema).
- **Clamp the result** to the property's legal range (opacity 0–100 %,
  scale ≥ 0). Bezier overshoot is a classic bug.
- Multi-dimensional properties (position) share one temporal curve **unless
  "separate dimensions"** is enabled (AE).

### 4.4 Value graph vs. speed graph, motion paths

- **Value graph:** property value vs. time. With separate dimensions, each
  axis gets its own curve.
- **Speed graph:** the derivative (units/s). For spatial properties it is
  the *magnitude of velocity along the path*. Dragging a speed-graph handle
  edits speed and influence directly. PR shows Value and Velocity graphs
  under each property in Effect Controls. AE's Graph Editor toggles between
  the two.
- **Motion path:** position keys draw a 2D path in the program monitor, with
  **dots at every frame**: dot spacing shows speed, and handles control the
  spatial Bezier. Spatial (path shape) and temporal (timing) interpolation
  are **independent**. Temporal easing maps time to the *arc-length fraction*
  along the path, so build an arc-length lookup table per path segment.
- **Implement in this order:** keyframe lane on the clip (diamonds) → value
  graph → speed graph → on-canvas motion path. Copy and paste keyframes with
  "relative to playhead" timing. Offer "scale attribute times" when pasting
  onto a clip of a different length (PR Paste Attributes and DR Paste
  Attributes both have this).

### 4.5 VEGAS Event Pan/Crop specifics (inverse camera model)

- The dialog shows **the source image** with a dashed **selection box with
  an "F"** that marks the frame's orientation (top). The box is *the region
  of the source that fills the output frame*:
  - **Smaller box = zoom in.** Moving the box right reveals the right side,
    so the image appears to move left. It's a camera over a still, i.e.
    inverse to Track Motion and to PR Position.
- **Controls:**
  - *Position:* Width, Height, X Center, Y Center.
  - *Rotation:* Angle.
  - *Keyframe interpolation:* Smoothness.
  - *Source:* Maintain aspect ratio, Stretch to fill frame, Reduce interlace
    flicker.
  - *Workspace:* zoom and grid.
  - Toolbar: **Lock Aspect Ratio**, **Size About Center**, **Move freely /
    X only / Y only**, snap to grid.
  - Right-click: Restore, Center, Flip Horizontal/Vertical, **Match Output
    Aspect**, Match Source Aspect.
- **Keyframes:** the lane at the bottom has **Position** and **Mask** rows.
  Interpolation types per key are Linear, Fast, Slow, Smooth, Sharp, Hold.
  **Smoothness** (path curvature) is separate from timing: 0 = linear path at
  constant speed.
- **Mask tab:** Bezier mask path, positive/negative mode, feather type
  (in / out / both), feather %. It is keyframeable.
- **Presets:** save, delete and preset list, used for Ken Burns moves.
- **Track Motion** is the *direct* layer transform (2D/3D), applied to the
  whole track composite. The **Crop OFX** gives on-canvas cropping.
- **For us:** one transform model, `cropRect` in source space + `layer
  transform` in output space, with two UIs. A "Pan/Crop" mode edits cropRect
  with the inverse metaphor, and the canvas gizmo edits the layer transform.
  Ken Burns presets are keyframed cropRects.

---

## 5. Effects and compositing

### 5.1 Blend / composite modes

| Premiere (27) | Resolve (Composite Mode) | VEGAS (track compositing mode) |
|---|---|---|
| Normal, Dissolve | Normal | **Source Alpha** (default) |
| Darken, Multiply, Color Burn, Linear Burn, Darker Color | Darken, Multiply, Color Burn, Linear Burn, Darker Color | Darken, **Multiply (Mask)**, Burn |
| Lighten, Screen, Color Dodge, Linear Dodge (Add), Lighter Color | Lighten, Screen, Color Dodge, Linear Dodge, Add, Lighter Color | Lighten, Screen, Dodge, Add |
| Overlay, Soft Light, Hard Light, Vivid Light, Linear Light, Pin Light, Hard Mix | Overlay, Softlight, Hardlight, Vivid Light, Linear Light, Pin Light, Hard Mix | Overlay, Hard Light |
| Difference, Exclusion, Subtract, Divide | Difference, Exclusion, Subtract, Divide | Difference, **Difference Squared**, Subtract, **Cut** |
| Hue, Saturation, Color, Luminosity | Hue, Saturation, Color, Luminosity | — |
| — | **Foreground, Alpha, Inverted Alpha, Lum, Inverted Lum** (use the clip as a matte for the track below) | **Custom** (2-to-1 compositor plug-ins: Displacement Map, Height Map, Bump Map) |

- **VEGAS parent/child compositing:** "Make Compositing Child" nests tracks
  under a parent, and the parent's mode decides how its group composites
  (classic mask: top track in Multiply (Mask) mode with the footage as
  children). Movie Studio has only Source Alpha and Multiply (Mask).
- **VEGAS compositing gamma:** in 32-bit full-range projects the choice is
  1.000 (linear, default) or 2.222 (video). Blending in linear light changes
  how Screen, Add and dissolves look.
- **Implement:** the W3C Compositing and Blending Level 1 formulas.
  - Separable modes: multiply = a·b; screen = a + b − a·b; overlay =
    hardlight with layers swapped.
  - Soft light: the W3C formula ≈ Photoshop. Note that Pegtop and Illusions
    variants differ, which is a source of "doesn't match PR" bug reports.
  - Non-separable modes: hue, saturation, color, luminosity via
    Lum/Sat/ClipColor.
  - Composite in **premultiplied alpha**. Note that PR, AE and DR blend in
    the working space (gamma-encoded Rec.709 by default).

### 5.2 Masks

| | Premiere | Resolve | VEGAS |
|---|---|---|---|
| Shapes | Ellipse, 4-point polygon, free-draw Bezier pen. **26.0: redesigned Shape Masks** (Bezier) + **AI Object Mask** (26.2 adds Sharp/Smooth edge quality) | **Power Windows**: Linear, Circle, Polygon, Curve (Bezier), Gradient. **Magic Mask** (AI person/object) | Pan/Crop Bezier mask; **Bezier Masking OFX** (up to 5 masks per event/track, trackable); AI Smart Mask |
| Parameters | Mask Path, **Feather** (px), Mask Opacity, **Mask Expansion**, Inverted. Masks attach per effect (an effect can be limited to a region) | Soft edge **inside/outside separately** (Soft 1–4 per edge on polygon/curve), Opacity, Invert, combine via the node graph | Mode +/−, feather in/out/both |
| Tracking | Track mask forward/backward (1 frame or to the end). Methods: Position; Position & Rotation; Position, Scale & Rotation | **Tracker palette**: Pan, Tilt, Zoom, Rotate, 3D (Perspective); cloud vs. point tracker; stabilize from tracks | Bezier Masking OFX tracking; Motion Tracking mode (Alt+M) |

**Implement:** masks are a shared component that any effect can reference:
- Bezier path (per-vertex in/out handles)
- feather as a signed-distance falloff, with inner and outer distances
- expansion
- opacity
- invert
- additive / subtractive / intersect boolean modes
- keyframed path (vertex count fixed per mask)
- tracker that writes the path's transform keys

### 5.3 Chroma key

| Premiere **Ultra Key** **(verify param names)** | Resolve | VEGAS **Chroma Keyer** |
|---|---|---|
| Key Color; Output (Composite / Alpha / Color Channel); Setting (Default / Relaxed / Aggressive / Custom) | **3D Keyer** (Color page, best), HSL qualifier, **Delta Keyer / Ultra Keyer** (Fusion) | Color (eyedropper) |
| Matte Generation: Transparency, Highlight, Shadow, Tolerance, Pedestal | Matte finesse: clean black/white, black/white clip, blur radius, in/out ratio | **Low Threshold / High Threshold** (matte luminance range) |
| Matte Cleanup: Choke, Soften, Contrast, Mid Point | Despill toggle | **Blur amount** (edge softness) |
| Spill Suppression: Desaturate, Range, Spill, Luma | | **Show Mask Only** |
| Color Correction: Saturation, Hue, Luminance | | |

**Implement:**
1. Key distance in YCbCr or Lab from the key color.
2. Map to alpha with low and high thresholds.
3. Clean up the matte: clip black/white, choke (erode/dilate), soften
   (blur).
4. Despill. Green: G' = min(G, (R+B)/2), or a "limit to max(R,B)" variant,
   with an amount slider.
5. Provide a matte view toggle (alpha / composite / status).

### 5.4 Stabilization

- **PR Warp Stabilizer (verify the exact defaults):**
  - Result: Smooth Motion (Smoothness %) or No Motion.
  - Method: Position / Position, Scale, Rotation / Perspective / **Subspace
    Warp** (default).
  - Framing: Stabilize Only / Stabilize, Crop / **Stabilize, Crop,
    Auto-scale** (default) / Stabilize, Synthesize Edges.
  - Rolling-shutter ripple reduction.
  - Analysis runs in the background with a banner.
- **DR (Inspector or Color tracker ▸ Stabilizer):** mode Perspective /
  Similarity / Translation; Camera Lock; Zoom; Cropping Ratio; Smooth;
  Strength.
- **VG Video Stabilization:** Basic / Professional / Expert views, Fast or
  Accurate analysis, choice of motion-compensation types, **Analyze
  Motion**. It can run as **Media FX** (analyzes the whole file, survives
  trims) or **Event FX** (analyzes only the used range, invalidated by
  trims). That is a good design distinction.
- **For us (desktop):** analyze with feature tracking (OpenCV-like) or
  ffmpeg `vidstabdetect`/`vidstabtransform`. Store the per-frame transforms
  keyed by *source* frame, so a trim doesn't force re-analysis (VG Media FX
  model).

### 5.5 Speed, time remapping, frame interpolation, reverse, freeze

| | Premiere | Resolve | VEGAS |
|---|---|---|---|
| Constant speed | **Speed/Duration** (Ctrl+R): Speed %, Duration, Reverse Speed, Maintain Audio Pitch, **Ripple Edit, Shifting Trailing Clips**, Time Interpolation | **Change Clip Speed** (R): speed %, fps, duration, ripple timeline, reverse, freeze frame, pitch correction | Event Properties ▸ **Playback rate** (as low as 0.05) + **Undersample rate** (strobe); **Ctrl+drag edge** = time stretch |
| Ramps | **Time Remapping**: a rubber band on the clip. Ctrl+click adds a speed keyframe; drag to split it into a ramp (gradual transition) | **Retime Controls** (Ctrl+R): speed points, ramp presets, **retime curve** (frame vs. speed curves with Bezier) | **Velocity envelope**: −100 % (reverse) to 300 %; right-click presets |
| Interpolation | Time Interpolation: **Frame Sampling / Frame Blending / Optical Flow** | Retime Process: **Nearest / Frame Blend / Optical Flow**; Motion Estimation Standard, Enhanced or **Speed Warp** (AI, Studio) | Project **Resample mode** (Frame blend / **Optical Flow** / Disable; *new projects default to Disable* in 2026), with a per-event override via switches; Slow Motion plug-in |
| Reverse | Reverse Speed checkbox | Reverse in Change Clip Speed / Retime | **Reverse** command (creates a reversed subclip; an arrow on the event), or a negative velocity |
| Freeze frame | **Add Frame Hold** (rest of the clip held), **Insert Frame Hold Segment** (2 s, ripples), Frame Hold Options (hold on Source TC / In / Out / playhead; hold filters); Export Frame Ctrl+Shift+E | **Freeze Frame** (Shift+R) | **Freeze Frame at Cursor**: velocity 0 from the cursor to the event end |

**Time-remap math:**
- The speed curve s(t) maps to a source position by integrating:
  src(t) = srcIn + ∫ s(τ) dτ.
- Store keyframes on the **speed** curve (the PR/DR UI) and precompute a
  cumulative table per frame.
- Optical-flow frames need neighbor frames, so decode ahead.
- Reverse playback of long-GOP sources requires decoding the GOP forward and
  emitting backward. Cache it.

### 5.6 Adjustment layers

- **PR:** Adjustment Layer (a project item placed on an upper track).
- **DR:** Adjustment Clip (Effects library).
- **VG:** **Adjustment tracks** (Ctrl+Shift+Alt+Q) and adjustment events.

Effects on them apply to everything below. Implement this as a clip with no
media that processes the composite under it.

### 5.7 Effect order pitfalls

- **PR:** standard effects render first (top to bottom), **then** the fixed
  effects Motion → Opacity. That's why editors use the *Transform* effect to
  scale *before* a blur or drop shadow.
- **VG:** layers are Media FX (per media, before everything), Event FX
  (+ Pan/Crop), Track FX, Track Motion, parent compositing, then Video Output
  FX.
- **For us:** make transform an orderable item in the stack (a "Transform"
  effect), and default the intrinsic transform to last. Document the order in
  the UI.

### 5.8 Transitions catalog and handles

**The common ~20.** Names are from each app's library. A "—" means there's
no same-named built-in (third-party or OFX packs usually fill the gap):

| # | Premiere | Resolve | VEGAS | Parameters worth supporting |
|---|---|---|---|---|
| 1 | **Cross Dissolve** (default) | Cross Dissolve (default) | Crossfade (overlap) / Dissolve | Duration, alignment |
| 2 | **Dip to Black** | Dip to Color Dissolve | Fade-to-color envelope / Flash | Color, hold length |
| 3 | **Dip to White** | Dip to Color Dissolve | Flash | Color |
| 4 | **Film Dissolve** (linear-light mix) | — | — | Gamma-correct mix |
| 5 | **Additive Dissolve** | Additive Dissolve | Dissolve (additive preset) | — |
| 6 | Non-Additive Dissolve | Non-Additive Dissolve | Dissolve preset | — |
| 7 | **Morph Cut** (jump-cut smoothing) | **Smooth Cut** | — | Analysis |
| 8 | **Push** | Push | Push | Direction |
| 9 | **Slide** | Slide | Slide | Direction |
| 10 | **Wipe** | Edge Wipe | Linear Wipe | Angle, feather, border width/color |
| 11 | **Band Wipe** / Venetian Blinds | Band Wipe / Venetian Blind Wipe | Venetian Blinds | Bands, direction |
| 12 | **Clock Wipe** / Radial Wipe | Clock Wipe / Radial Wipe | Clock Wipe | Center, start angle |
| 13 | **Iris Round / Box / Diamond / Cross** | Iris (oval, square, diamond, cross, …) | Iris | Shape, center, feather |
| 14 | **Barn Doors** | Barn Door | Barn Door | Orientation |
| 15 | **Split** / Center Split | Split | Split | Orientation |
| 16 | **Gradient Wipe** (luma image) | Gradient-style wipes **(verify)** | Gradient Map | Gradient image, softness |
| 17 | **Cross Zoom** | Fusion transitions (zoom) **(verify)** | Zoom | Strength, center |
| 18 | **Page Peel / Page Turn** | — | Page Peel / Page Loop | Direction, curl |
| 19 | **Cube Spin / Flip Over** | Fusion/3D transitions **(verify)** | Cube-style 3D, Swap | Axis |
| 20 | Blur dissolve, whip, light leak, glitch (**Film Impact** set added in 26.2; Shape Dissolve in 26.3) | Blur Dissolve; Fusion transitions | Spiral, Star Wipe, Squeeze, **GL transitions** | Preset-driven |
| A | **Audio:** Constant Power (default), Constant Gain, Exponential Fade | Cross Fade +3 dB, 0 dB, −3 dB | Fade-curve pairs (Fast / Slow / Linear / Smooth / Sharp) | Curve |

Every transition has: duration, **alignment** (center on cut / start at cut
/ end at cut), reverse/direction, border width and color, feather, a
custom-start/end progress option (VG **transition progress envelope**:
hold, reverse, repeat), and anti-aliasing.

**Handles (the part CapCut hides):**
```
cut at sequence frame 10
A media: 100 ......... 109 | 110 ... 129     (A's tail handle = 20 unused frames)
B media: 190 ... 199 | 200 ......... 209     (B's head handle = 10 unused frames)

10-frame dissolve, CENTER on cut → sequence frames 5–14
   A supplies 105–114 (needs 5 tail-handle frames 110–114)
   B supplies 195–204 (needs 5 head-handle frames 195–199)
START at cut → frames 10–19: A needs 110–119 (10 tail), B uses 200–209 (no head)
END at cut   → frames 0–9:   A uses 100–109,  B needs 190–199 (10 head)
```
- **PR:** a transition with insufficient media is drawn with **diagonal
  hatching**. The dialog says *"Insufficient media. This transition will
  contain repeated frames"* and it freeze-repeats. Ctrl+D (video), Ctrl+Shift+D
  (audio) and Shift+D (both, to the selection) apply the default transition.
  The default duration is in Preferences ▸ Timeline (≈1 s).
- **DR:** the default "Standard transition" duration (Preferences ▸ Editing,
  ≈1 s), centered. Ctrl+T video + audio, Alt+T video, Shift+T audio. Without
  handles the transition is shortened, or it can't be added on that side
  **(verify)**.
- **VG:** transitions *are overlaps*. Cut-to-overlap conversion
  (Preferences ▸ Editing) sets the overlap **amount** and **alignment:
  Before cut / Centered on cut / After cut**, and extends events into their
  handles. Without media, the event either **loops** (if the Loop switch is
  on) or shows nothing/silence. Numpad `/` converts cut→transition and
  Ctrl+Numpad `/` converts transition→cut.
- **Media handles in export and interchange:** trimmed consolidation (PR
  Project Manager, DR Media Management, VG "copy and trim media") keeps
  N frames of handles beyond each used range, commonly 24–48 frames or
  1–2 s, so transitions and trims still work later.

---

## 6. Color

### 6.1 Premiere Lumetri Color (panel order = processing order)

| Section | Controls |
|---|---|
| **Basic Correction** | Input LUT (legacy; 25+ color management handles log/camera transforms); **Auto**; **White Balance**: WB selector (eyedropper), **Temperature, Tint**; **Tone**: **Exposure, Contrast, Highlights, Shadows, Whites, Blacks**; **Saturation**; Reset |
| **Creative** | **Look** (LUT browser and preview), **Intensity**; Adjustments: **Faded Film, Sharpen, Vibrance, Saturation**, **Shadow Tint / Highlight Tint** (wheels), **Tint Balance** |
| **Curves** | **RGB Curves** (master/luma + R, G, B); **Hue Saturation Curves**: **Hue vs Sat, Hue vs Hue, Hue vs Luma, Luma vs Sat, Sat vs Sat**, with an eyedropper to place points |
| **Color Wheels & Match** | Comparison View, **Apply Match** (with Face Detection); **Shadows / Midtones / Highlights** wheels, each with a luminance slider |
| **HSL Secondary** | Key: set color (+/− eyedroppers), **H / S / L range sliders with soft falloff**, Show Mask (color/gray, color/black, white/black), Invert; Refine: **Denoise, Blur**; Correction: 1-way or 3-way wheel, **Temperature, Tint, Contrast, Sharpen, Saturation** |
| **Vignette** | **Amount, Midpoint, Roundness, Feather** |

**Color management (25.0+):** sequence working and output color spaces,
automatic log detection and tone mapping, and Rec.2100 HLG/PQ HDR
sequences. Before 25.0 the pipeline was display-referred Rec.709.

### 6.2 Resolve primaries and Color page

| Tool | Controls / math |
|---|---|
| **Color Wheels** (primaries) | **Lift** (shadows; white point pinned), **Gamma** (midtones, power curve), **Gain** (highlights; black pinned), **Offset** (adds to everything). Each wheel = color balance + master ring (Y). There are also Primaries Bars (per-channel YRGB) and **Log wheels** (Shadow / Midtone / Highlight / Offset with Low/High range) |
| Adjustments | **Contrast, Pivot**, Midtone Detail, Color Boost, Shadows, Highlights, **Saturation, Hue, Lum Mix**, **Temp, Tint** |
| **HDR palette** | Zone wheels: Black, Dark, Shadow, Light, Highlight, Specular + Global, with exposure-based falloff |
| **Curves** | Custom (YRGB, linked or unlinked), **Hue vs Hue, Hue vs Sat, Hue vs Lum, Lum vs Sat, Sat vs Sat, Sat vs Lum** |
| **Qualifier** | HSL, RGB, Luma, **3D** (sampled strokes); matte finesse (clean black/white, blur, in/out) |
| **Windows** | Linear, Circle, Polygon, Curve, Gradient + soft edges + tracker; Magic Mask |
| Structure | **Node graph** (serial Alt+S, parallel, layer nodes, outside node), versions, stills gallery, shared nodes, **CDL** import/export |

**Implementable lift/gamma/gain.** This is the common approximation, not
Resolve's exact internal math. Normalize the controls so that neutral =
lift 0, gamma 1, gain 1, offset 0:
```
x' = gain * (x + lift * (1 - x))
y  = sign(x') * |x'|^(1/gamma)
y  = y + offset
```
Apply per channel (balance) and to master (luma). For interchange, use
**ASC CDL**: `out = clamp((in * slope + offset) ^ power)` plus saturation
with Rec.709 luma weights. DR imports and exports CDL (.cdl/.cc/.ccc, and
CDL inside EDL).

### 6.3 VEGAS Color Grading (Alt+G)

- **LUTs:** Camera LUT and Look LUT slots, each with **Strength**, a
  **tetrahedral interpolation** toggle, A/B selection and browse.
- **Color wheels** (lift / gamma / gain / offset style), Curves, and **HSL
  curves**: Hue vs Hue, Hue vs Sat, Hue vs Lum, Lum vs Sat, Sat vs Sat, Sat
  vs Lum.
- Plus utilities and the classic Color Corrector / Secondary / Curves /
  Broadcast Colors / Levels FX.
- **ACES:** version and color space, a view transform, and a look
  modification transform ("Blue Light Artifact Fix").

### 6.4 LUTs (.cube)

- **Format (Adobe/Resolve spec):**
  - Optional `TITLE "…"`.
  - **`LUT_1D_SIZE N`** (2–65536) or **`LUT_3D_SIZE N`** (2–256; typically
    17, 33 or 65).
  - Optional `DOMAIN_MIN r g b` / `DOMAIN_MAX r g b` (default 0 0 0 / 1 1 1).
  - `#` comments.
  - Then N or N³ lines of `R G B` floats. For 3D LUTs, **red varies
    fastest**, then green, then blue.
- **Apply:**
  - 1D: per-channel linear interpolation.
  - 3D: **trilinear** (fast) or **tetrahedral** (better neutral gradients;
    VEGAS and DR offer it).
  - On the GPU, upload as a 3D texture and sample with hardware trilinear at
    texel centers: `coord = (v * (N−1) + 0.5) / N`.
- A LUT assumes a specific **input encoding** (for example LogC3/AWG →
  Rec.709). Applying it to the wrong encoding is the #1 user error, so label
  each slot "Input LUT (technical)" vs. "Look (creative)".
- **Supported formats:** PR loads .cube (and legacy .look). DR loads .cube
  plus other formats (.3dl, …). VG loads .cube.

### 6.5 Scopes (and how to compute them)

| Scope | PR (Lumetri Scopes) | DR | VG |
|---|---|---|---|
| Waveform | **RGB, Luma, YC, YC no Chroma** | Waveform (Y or RGB overlay) | Waveform |
| Parade | **RGB, YUV** | Parade (RGB / YRGB) | Parade (RGB) |
| Vectorscope | **YUV**, **HLS** | Vectorscope (2× zoom, skin-tone line, 75 % / 100 % targets) | Vectorscope |
| Histogram | Yes | Yes | Histogram |
| Other | Scale: 8-bit / float / HDR (nits); color space Rec.601/709/2020/2100 | **CIE chromaticity**; 1-up / 2-up / 4-up; low-pass filter; HDR nits scale | "Studio RGB (16–235)" scale option |

**Computation (GPU compute or WebGL2 fragment scatter):**
1. Downsample the frame first (≈512–1024 px wide) and run at 10–15 Hz during
   playback. Compute on the **output of the color pipeline**, in the
   output's encoding.
2. **Luma** Y′ = Kr·R′ + Kg·G′ + Kb·B′:
   - Rec.709: 0.2126, 0.7152, 0.0722
   - Rec.601: 0.299, 0.587, 0.114
   - Rec.2020: 0.2627, 0.6780, 0.0593
3. **Waveform:** for each pixel, `bins[x_col][quantize(Y′)] += 1`. Columns =
   output width; 256–1024 rows. Display intensity = log or gamma of the
   count. Overlay a graticule: 0–100 IRE (legal 8-bit 16–235, 10-bit 64–940)
   or 0–700 mV, with optional 1023/nits scales.
4. **Parade:** the same with R, G, B (or Y, Cb, Cr) in three side-by-side
   panes.
5. **Vectorscope:** a 2D histogram over (Cb, Cr), each ∈ [−0.5, 0.5]. Angle
   = hue, radius = saturation. Draw the targets for **75 % and 100 % color
   bars** (R, Mg, B, Cy, G, Yl) and the **skin-tone line at ≈123°**
   (counterclockwise from the +Cb axis, between red and yellow).
6. **Histogram:** 256 bins (or more) per channel + luma, stacked or overlaid,
   log option.
7. Use atomics in a compute shader (WebGPU/wgpu). On WebGL2, use point
   sprites with additive blending into a float render target.

### 6.6 Color management basics

- **Rec.709 SDR:**
  - Primaries BT.709, D65 white.
  - Camera OETF ≈ gamma 0.45 with a linear toe. Display EOTF is
    **BT.1886 (≈2.4)** for grading suites; web/sRGB displays use ≈2.2. DR
    offers "Rec.709 Gamma 2.4" vs. "Rec.709-A" (the Apple compensation tag).
  - Tag outputs **1-1-1** (primaries/transfer/matrix) in the `colr`/`nclx`
    atom or VUI. The QuickTime gamma "shift" on macOS is a perennial
    complaint.
- **Range:**
  - Video (limited): 8-bit Y′ 16–235, C 16–240; 10-bit 64–940 / 64–960.
  - Full: 0–255. Phone footage is mostly limited range, but some is **full
    range** (flagged).
  - Screen recordings and PNG/RGB sources are full range. Respect the
    `color_range` flag, and offer a per-clip override. VEGAS does this in
    8-bit full-range mode, under Media Properties ▸ Color Range.
- **HDR:**
  - Rec.2020 primaries + **PQ (SMPTE ST 2084**, absolute, up to 10,000
    nits) or **HLG** (relative, broadcast).
  - HDR10 metadata: mastering display (ST 2086) + **MaxCLL / MaxFALL**.
  - DR Studio adds Dolby Vision analysis.
  - VEGAS "HDR Mode" (HDR10 or HLG) switches the project to 32-bit float
    full range with an ACES view transform ("Rec 2020 ST2084 1000 nits") and
    filters render presets to HDR-compatible ones.
- **Working spaces:**
  - DR: **DaVinci YRGB** (display-referred), **DaVinci YRGB Color Managed**
    (presets: SDR Rec.709, HDR, DaVinci Wide Gamut/Intermediate), or
    ACEScct/ACEScc.
  - PR 25+: color-managed sequences.
  - VG: ACES, or legacy 8-bit video-levels / 8-bit full-range (default) /
    32-bit float (video or full).
- **For us:**
  - P0: correct Rec.709 SDR with range and matrix handling, plus tagging.
  - P1: log-to-709 via LUTs.
  - P2: a color-managed linear working space (OCIO/ACES) and HDR PQ/HLG
    output.

---

## 7. Audio

### 7.1 Signal chain (copy this order)

```
clip source → clip gain (PR "Audio Gain", G) → clip effects → clip volume keyframes/fades
→ track inserts (pre-fader) → track fader (volume automation) → pan/balance
→ sends (pre/post fader) → bus/submix → master inserts → master fader → meters/out
```

| | Premiere | Resolve | VEGAS |
|---|---|---|---|
| Clip level | **Audio Gain** (G): Set Gain to, Adjust Gain by, **Normalize Max Peak to**, **Normalize All Peaks to**. **Clip volume** keyframes (rubber band). `[` / `]` = clip volume −1 / +1 dB (Shift = many) | Clip **volume** overlay line (Alt+click = keyframe), Inspector Volume, **Normalize Audio Levels** (sample peak, true peak, or **ITU-R BS.1770 loudness**; relative or independent) | **Event envelope** (gain line on top of the event); **Normalize** switch; **Auto Normalize** (2026: recomputed after every split/trim) |
| Track level | **Audio Track Mixer** (Shift+6): fader, pan, M/S/R, **5 insert + 5 send** slots, automation modes **Off / Read / Latch / Touch / Write**; **Audio Clip Mixer** (Shift+9) | Edit-page Mixer; **Fairlight**: per-channel EQ (6-band) + **Dynamics** (expander/gate, compressor, limiter), busses, automation | **Mixing Console** (Ctrl+Alt+5): inserts, sends, busses A–Z, assignable FX; track volume envelope (V), pan envelope (P); default track FX chain **Track Noise Gate → Track EQ → Track Compressor** |
| Pan laws | Stereo balance / mono pan | Pan with selectable law **(verify)** | **Add Channels, Balance (0 / −3 / −6 dB center), Constant Power, …** per track |
| Global | 26.2 **Global Mute** | — | Ctrl+Shift+F12 = dim master |

### 7.2 Fades and crossfades

| | Premiere | Resolve | VEGAS |
|---|---|---|---|
| Fade handles | 26.0 added **interactive audio fades** (handles on the clip) | **Fade handles** at the clip's top corners + a curvature handle | Drag the event's upper corner. **Quick fades** (a few ms) auto-applied to new edges |
| Crossfade types | **Constant Power** (default, equal-power), **Constant Gain** (linear), **Exponential Fade** | **Cross Fade +3 dB, 0 dB, −3 dB** | Fade-curve pairs from **Fast, Slow, Linear, Smooth, Sharp** (right-click ▸ Fade Type) |
| Default duration | Preferences (≈1 s) | Preferences (≈1 s) | Overlap amount |

**Curves** (t ∈ [0, 1]; outgoing = mirror):
- linear g = t
- equal power g_in = sin(πt/2), g_out = cos(πt/2) (+3 dB in the middle vs.
  linear for uncorrelated audio)
- S-curve "smooth" g = ½ − ½·cos(πt)
- "fast" / "slow" = log / exponential shapes, e.g. g = t^0.5 and t^2, or dB-
  linear ramps

Use **equal power** for uncorrelated material (different shots) and
**linear (0 dB)** for correlated material (same source, a split cut) to avoid
a +3 dB bump.

### 7.3 Meters and loudness

- **Sample peak (dBFS):** 20·log10(|x|max), 0 dBFS = full scale. Meters
  usually show a 60–96 dB range with **peak hold** (a decay or infinite
  hold) and clip LEDs. PR meters show dBFS with optional dynamic or static
  peak hold.
- **True peak (dBTP):** ≥4× oversampled peak (BS.1770 annex). It catches
  inter-sample overs that appear after AAC/MP3 encoding.
- **RMS:** windowed (~300 ms) average power. It is useful but not a loudness
  standard.
- **Loudness (LUFS/LKFS, ITU-R BS.1770-4 / EBU R128):**
  1. Apply **K-weighting**: a high-shelf pre-filter of +4 dB above ~1.5 kHz,
     then the RLB high-pass at ~38 Hz.
  2. Take mean square per channel. Channel weights: L/R/C 1.0,
     Ls/Rs 1.41 (+1.5 dB), LFE excluded.
  3. **Momentary** = 400 ms window. **Short-term** = 3 s window.
  4. **Integrated:** 400 ms blocks with 75 % overlap, an **absolute gate at
     −70 LUFS**, then a **relative gate at −10 LU** below the
     ungated mean. L = −0.691 + 10·log10(Σ Gᵢ·zᵢ).
  5. **Loudness range (LRA):** from the short-term distribution (relative
     gate −20 LU), the 10th to 95th percentile spread.
- **Where to see it:**
  - PR: Loudness Meter effect / Essential Sound auto-match, plus **Export ▸
    Effects ▸ Loudness Normalization** (standard, target, tolerance, max
    true peak).
  - DR: Fairlight loudness meter (BS.1770, R128, ATSC; integrated,
    short-term, momentary, range, true peak) and Deliver audio
    normalization.
  - VG: **Loudness Meters** window (Ctrl+Alt+7) and a **loudness log**
    (`_loud.txt`, measured *after the plug-in chain, before the codec*;
    rerun on the rendered file).

| Target | Integrated | True peak | Notes |
|---|---|---|---|
| **YouTube** | ≈ **−14 LUFS** (playback normalization turns loud content down, never up) | −1 dBTP | No official upload spec |
| Spotify | −14 LUFS (Loud −11, Quiet −19) | −1 dBTP (−2 if louder than −14) | Music |
| Apple Music / Apple Podcasts | −16 LUFS | −1 dBTP | |
| TikTok / Instagram / Facebook | No published spec; **−14 LUFS** common practice | −1 dBTP | |
| **EBU R128** (EU broadcast) | **−23 LUFS ±0.5 LU** (±1 live) | **−1 dBTP** | Full program |
| **ATSC A/85** (US broadcast) | **−24 LKFS ±2** | −2 dBTP | Dialogue-anchored in long-form |
| **Netflix** | **−27 LKFS ±2, dialog-gated** | **−2 dBTP** | |
| Podcast (general) | −16 (stereo) / −19 (mono) LUFS | −1 dBTP | |

**Implement:**
- A "Normalize to target" action per clip or selection: compute the
  integrated loudness of the used range and set the clip gain to the delta.
- Export-time loudness normalization: two-pass, gain + true-peak limiter.

### 7.4 EQ, dynamics, noise reduction (what to ship)

- **PR:** Parametric Equalizer, Simple Parametric EQ, Graphic EQ
  (10/20/30 band), Dynamics (Gate / Compressor / Expander / Limiter),
  Multiband Compressor, Hard Limiter, **DeNoise, DeHum, DeReverb, DeEsser**,
  Adaptive Noise Reduction.
  - **Essential Sound:** Dialogue / Music / SFX / Ambience types. Dialogue
    has Loudness auto-match; Repair (Reduce Noise, Reduce Rumble, DeHum,
    DeEss, Reduce Reverb); Clarity (Dynamics, EQ presets, **Enhance
    Speech** AI); Creative (Reverb).
  - Music has Duration (Remix) and **Ducking** (auto-keyframes under
    dialogue).
- **DR Fairlight FX:** Noise Reduction, De-Esser, De-Hummer, **Dialogue
  Processor**, **Voice Isolation** (AI), **Dialogue Leveler**, Ducker,
  Limiter, Multiband Compressor, Reverb, Delay, Pitch.
- **VG:** Track Noise Gate / Track EQ / Track Compressor on every track, plus
  Modern EQ, auto-ducking, and assignable FX busses.
- **For us:**
  - P0: 3–4-band parametric EQ, compressor/limiter, noise gate, a simple
    spectral denoise, fades.
  - P1: ducking (sidechain on dialogue-tagged tracks), true-peak limiter,
    de-esser, AI voice isolation (see [[AI and automation]]).

---

## 8. Media and formats

### 8.1 Import support (Windows unless noted)

| Format / codec | Premiere (help page, Jan 2026) | Resolve (codec list, July 2025; R21 similar) | VEGAS Pro 2026 (spec page) |
|---|---|---|---|
| **H.264 / AVC** (MP4, MOV, MTS/M2TS AVCHD) | Yes | Yes. Free: 8-bit OS-supported profiles; **Studio**: more profiles (4:2:2, 10-bit) + GPU decode | Yes. 2026 adds NVIDIA Blackwell **4:2:2 GPU decode** |
| **H.265 / HEVC** | Yes (≤8192×4320). Windows needs the HEVC Video Extensions | Yes. Free: 8/10-bit OS profiles; Studio: more + GPU | Yes (4:2:2 GPU on Blackwell) |
| **AV1** | **Not in the official list** (verify current build) | **Decode, GPU-accelerated** (MOV/MP4/MKV); **encode with HW** (NVIDIA RTX 40+, AMD RX 7000+, Intel Arc) | Import and export listed in the VEGAS 22 spec; not on the 2026 page **(verify)** |
| **VP9 / WebM** | **No** (third-party importers such as WebMiere; Adobe said VP9 isn't on the roadmap) | VP9 decode in MOV/MP4/**MKV**; **WebM not listed** | No |
| **MKV** | H.264-in-MKV (added in a 2024–25 beta; a 26.3.2 crash fix confirms it exists) | Decode H.264/H.265/VP9 in MKV | No |
| **ProRes** (422 Proxy … 4444 XQ) | Yes, decode **and encode on Windows**; ProRes HDR, **ProRes RAW**, ProRes Log | Decode + **encode on Windows** (MOV, MXF) | Import ProRes + **ProRes RAW**; export ProRes |
| **DNxHD / DNxHR** (LB, SQ, HQ, HQX, 444) | Yes (MXF + MOV); export too | Yes, decode + encode (MOV, MXF OP1a / OP-Atom) | Not on the spec page **(verify)** |
| **CineForm** | Yes (export too) | Yes (AVI/MOV) | — |
| **MXF** | OP1a / OP-Atom: XDCAM HD/EX, XAVC (Intra/Long, H), AVC-Intra, P2, IMX, JPEG2000, ARRIRAW, Sony X-OCN, Canon XF; **growing files** | Yes (broad, many Studio-only for 10-bit XAVC / AVC-Intra) | XDCAM/XAVC/P2/HDCAM SR/IMX MXF |
| **AVI** | DV-AVI, AVI Type 1/2 | DV, PhotoJPEG, CineForm, uncompressed, Grass Valley | Yes (VfW codecs) |
| **RAW** | R3D, ARRIRAW, Canon CRM, Sony X-OCN, ProRes RAW, BRAW (help page exists) | **BRAW, R3D (GPU), ARRIRAW, Canon RAW, Sony RAW/X-OCN, Nikon N-RAW, CinemaDNG** | **BRAW, R3D, ProRes RAW** |
| **Image sequences** | Numbered stills ("Image Sequence" checkbox): DPX, EXR, TIFF, PNG, TGA, JPEG, PSD | Auto-detected sequences: **DPX, Cineon, EXR**, TIFF, PNG, JPEG, DNG, etc. | DPX, OpenEXR, PNG, JPG, TIFF, DNG, HEIC |
| Audio | WAV/BWF, AIFF, MP3, AAC/M4A | WAV, AIFF, MP3, AAC, FLAC, … | AIFF, AAC, MP2, MP3, M4A, OGG Vorbis, WAV, WMA, FLAC |
| Captions | SRT, SCC, MCC, DFXP, STL, W3C/SMPTE/EBU TT XML | SRT, WebVTT, … | SRT |
| Max size | Sequence 10,240×8,192; stills ≤256 MP (≤32,768 px on a side) | Very large (8K+) | 2026: up to 8K |

**Containers ≠ codecs:** an MP4 can play, import audio-only, or fail
depending on the stream inside. Probe streams (ffprobe/mediabunny) and
report *per stream* why an import failed.

### 8.2 Variable frame rate (phone and screen-recorder footage)

- Phones and OBS/screen recorders write **VFR**: per-frame timestamps vary
  (for example 29.2–30.6 fps), and the container advertises an average rate.
- NLEs that assume CFR **drift A/V sync** over long clips: audio runs on the
  sample clock while video counts frames. They also stutter.
- **PR:** detects VFR (Properties shows "Variable frame rate") and conforms
  it. Long clips can still drift, and Adobe-adjacent guidance is to
  transcode to CFR.
- **DR:** VFR isn't supported. The standard advice is to transcode first,
  e.g. `ffmpeg -fps_mode cfr -r 30000/1001` (Handbrake "Constant framerate").
- **VG:** has an A/V sync detection and repair tool. VFR can still drift.
- **For us (P0):**
  1. On import, scan PTS deltas (sample the first, middle and last ~300
     frames). Flag VFR when the stddev exceeds 1 % of the mean frame
     duration.
  2. Present by timestamp: the frame shown at sequence time t is the last
     source frame with PTS ≤ t. That stays in sync with audio by
     construction.
  3. Offer "Conform to CFR" (desktop: background ffmpeg transcode to an
     intra or short-GOP mezzanine).

### 8.3 Proxy workflow requirements

- A proxy must match the original's **duration, frame rate, start
  timecode, audio channel layout and aspect ratio**. Resolution and codec
  may differ.
- Attach the proxy to the master clip, and keep a full-res/proxy toggle per
  project (PR button, DR "Prefer proxies", VG preview-quality driven).
- Export always uses originals unless the user explicitly opts in.
- **Codecs:**
  - Desktop: ProRes Proxy/LT or DNxHR LB, intra-frame for instant seeking.
  - Web build: **H.264 with a short GOP (≤15) or all-intra at 540p/720p**,
    since WebCodecs seeks to keyframes.
- **Optimized media** (DR) = a full-res mezzanine for heavy codecs. It is
  another kind of proxy.

### 8.4 Render / export

| | Premiere | Resolve (Deliver) | VEGAS (Render As) |
|---|---|---|---|
| Presets | Export mode / Media Encoder presets: H.264 (Match Source – High / Adaptive bitrate), HEVC, ProRes, DNxHR, CineForm; social presets (YouTube, Vimeo, TikTok, …) | Render presets: Custom, YouTube, Vimeo, TikTok, X, H.264/H.265 Master, ProRes, IMF, audio-only; single clip vs. **individual clips** | Templates: MAGIX AVC/AAC MP4, HEVC MP4, ProRes, XAVC/XDCAM MXF, WAV, … filtered by "Match project settings"; HDR-compatible filter |
| Encoders | Software + HW (NVENC / QuickSync / AMF); VBR 1/2-pass, CBR | Native + HW; quality vs. bitrate; Studio adds more | MAGIX (NVENC / QSV / AMF), Mainconcept |
| Extras | **Use Previews**, **Loudness Normalization**, captions (burn-in / sidecar), chapter markers, Frame.io upload | Bypass re-encode, chapters from markers, subtitles, render in place | **Render loudness log**, render to new track (Ctrl+M), region batch rendering via scripts |

**Smart rendering (no re-encode of untouched frames):**
- **VG:** "no-recompress rendering" when source, project and template match
  in width, height, frame rate, field order, profile/level and bitrate.
  Formats: **DV AVI, DV MXF, IMX MXF, XAVC Intra MXF, HD MXF, MPEG-2 (HDV),
  P2, XDCAM EX**. Frames with effects, transitions, compositing or
  resampling are re-encoded. Toggle: Preferences ▸ File I/O.
- **PR:** smart rendering for intra/mezzanine codecs (ProRes, DNxHD/HR,
  XDCAM HD, AVC-Intra, CineForm, …) when the export matches the preview or
  source codec ("Use Previews"). Long-GOP H.264 is generally not smart-
  rendered **(verify)**.
- **DR:** "Bypass re-encode when possible" for matching mezzanine codecs
  **(verify scope)**.
- **For us (P1):** "trim-only export" stream-copies untouched GOPs and
  re-encodes only the GOPs that touch a cut or an effect. The encoder must
  match SPS/PPS, profile and level. Practical with ffmpeg on desktop. This
  is a real speed win for long talking-head cuts.

### 8.5 Frame-rate conversion and interlacing

- **Conform (reinterpret)** vs. **resample:**
  - Conform: PR Interpret Footage ▸ assume frame rate; DR Clip Attributes ▸
    frame rate; VG playback rate for HFR. It plays every frame at the new
    rate (slow motion, audio pitch changes).
  - Resample: frames are picked (**nearest / frame sampling**), **blended**,
    or **optical-flow synthesized**.
- **Common pairs:**
  - 23.976↔24 (0.1 %, 3.6 s/hour drift if mismatched)
  - 25↔24 (PAL speed-up, 4.17 %, pitch)
  - 59.94→29.97 (drop every other frame)
  - 23.976→29.97 (3:2 pulldown, broadcast only)
- **DR:** the project/timeline frame rate is effectively fixed once media is
  edited (set per timeline at creation). **VG:** the project frame rate can
  change any time, but events then land off-grid. "**Show unquantized event
  edges**" highlights them, and unquantized cuts render as 1-frame blends.
- **Interlacing:**
  - Field order: progressive / **upper first** (HD 1080i) / **lower first**
    (DV).
  - Deinterlace methods: VG **None / Blend fields / Interpolate / Smart
    adaptive (GPU)**; PR Field Options (Always Deinterlace, Reduce
    Flicker); ffmpeg yadif/bwdif.
  - Always deinterlace for web output. Detect interlacing from the stream's
    `field_order`.

---

## 9. Project and collaboration

### 9.1 Saving, autosave, versions

| | Premiere | Resolve | VEGAS |
|---|---|---|---|
| Project file | `.prproj` (**gzipped XML**). **Productions** (folder of projects with locking). Team Projects (cloud, legacy) | Projects live in a **project library/database** (disk or PostgreSQL; Blackmagic Cloud). `.drp` export, `.drt` timeline export, `.dra` archive with media | `.veg` (binary); `.vf` (Movie Studio) |
| Autosave | Preferences ▸ Auto Save: **every 15 min, max 20 versions** (defaults), to an Auto-Save folder; options to back up to Creative Cloud and "Auto Save also saves the current project" | **Live Save** (continuous) + **Project Backups** (every N minutes, hourly for H hours, daily for D days) | **Advanced Save** (Tools): **Live Save**; backup intervals in minutes (kept 1 h), hours (kept 10 h), daily archive (≤500), or real-time per-edit backups (≤500); legacy autosave every 5 min (`.autosave.veg`, crash recovery); **`.veg.bak`** on every save; **Incremental Save** Ctrl+Alt+S → `name_0001.veg`, `_0002`, … |
| Undo | History panel (configurable depth) | Edit ▸ History | Undo history list (unlimited) |

**For us (P0):**
- An atomic save (write to temp, fsync, rename).
- Autosave every N minutes **and** on idle, to a versions folder with
  rotation (minute / hour / day tiers, as VEGAS does).
- Crash-recovery prompt on launch.
- "Save version" (Ctrl+Alt+S semantics).
- The web build saves to OPFS with the same tiers.

### 9.2 Media management and relinking

- **Consolidate / collect:**
  - PR **Project Manager**: Collect Files and Copy, or Consolidate and
    Transcode. Options include exclude unused, **include handles**,
    rename media to clip names, include previews and conformed audio.
  - DR **Media Management**: Copy / Move / Transcode, whole clips or used
    clips with handles.
  - VG **Save As**: copy media with the project, or copy and **trim** media.
- **Offline media:** PR shows a red "Media Offline" slate. Relink dialogs
  offer:
  - PR **Link Media**: match on file name, extension, media start
    (timecode), tape name, file metadata ID; "Relink others automatically";
    search.
  - DR: Relink Selected Clips (pick a folder, recursive), Change Source
    Folder, conform by **timecode + reel name + file name**.
  - VG: Find / Browse / Leave offline on open.
  - PR 26.0 made relinking easier.
- **Our media reference record:**
  - absolute path, path **relative to the project file**, size, mtime
  - a content fingerprint (hash of the first and last 64 KB + duration +
    codec + start timecode)
  - the proxy path

  On open: try the relative path → absolute → same-name siblings in the last
  relink folder. Then run a "search folder recursively" scan that scores
  candidates on fingerprint fields. After the first manual relink, relink the
  rest automatically.

### 9.3 Interchange

| Format | Premiere | Resolve | VEGAS 2026 | What it carries | Realistic for us |
|---|---|---|---|---|---|
| **EDL CMX3600** | Import + export | Import + export | **Own EDL text format** ("not intended as interchange") | One video track + ≤4 audio channels, cuts/dissolves/wipe codes, speed (M2), 8-char reel names, timecode | **P1 export** (trivial; color/conform houses still ask for it) |
| **FCP7 XML (xmeml)** | Import + export | Import + export | Import + export ("Final Cut Pro 7 / DaVinci Resolve (*.xml)") | Multi-track, transforms, opacity, basic transitions, markers, speed | **P1 export, P2 import**: the lingua franca of all three |
| **FCPXML** | — (third-party) | Import + export | Import + export | Magnetic storyline model, roles | P2 |
| **OpenTimelineIO (.otio)** | No native support known **(verify)** | **Import + export** (since 18.5) | — | JSON timeline: tracks, clips, gaps, transitions, markers, media refs; adapters to EDL/FCP XML/AAF | **P1**: it's just JSON, open source (ASWF), and adapters reach everything else |
| **AAF** | Export (+ Avid import) | Import + export | Not listed in 2026 | Avid/ProTools interchange, audio handles | P2 (binary structured storage, hard); route via OTIO adapters |
| Premiere `.prproj` | Native | — | **Import + export** | Full project (undocumented gz XML) | No |
| DR `.drp/.drt` | — | Native | — | — | No |
| Captions SRT / WebVTT / SCC | Import + export | Import + export | SRT import | | **P0 SRT/VTT** |
| ASC CDL / ALE / CSV markers | CSV batch lists | CDL, ALE, CSV | — | Grades and metadata | P2 |

---

## 10. Default keyboard shortcuts (merged, Windows)

The key for these defaults: "—" means there's no default key, and **(verify)**
means the cell is from a secondary source. DR keys are for the "DaVinci
Resolve" keyboard preset (DR also ships Premiere, FCP and Avid presets).

| # | Action | Premiere | VEGAS Pro | Resolve |
|---|---|---|---|---|
| 1 | Play / stop | Space | Space (stop returns to start); Enter = play/pause | Space |
| 2 | Shuttle reverse / stop / forward | J / K / L | J / K / L | J / K / L |
| 3 | Slow or fine shuttle | Shift+J / Shift+L (fine steps) | K+J / K+L (knob) | K+J / K+L (Shift+J/L = **fast**) |
| 4 | Step 1 frame | ← / → | Alt+← / Alt+→ | ← / → |
| 5 | Big step | Shift+←/→ (5 f) | Page Up / Page Down (grid) | Shift+←/→ (1 s) |
| 6 | Go to start / end | Home / End | Ctrl+Home / Ctrl+End | Home / End |
| 7 | Previous / next edit | ↑ / ↓ | Ctrl+Alt+← / → | ↑ / ↓ |
| 8 | Previous / next marker | Ctrl+Shift+M / Shift+M | Ctrl+← / Ctrl+→ | Shift+↑ / Shift+↓ |
| 9 | Mark In / Out | I / O | I / O | I / O |
| 10 | Mark clip | X | — | X |
| 11 | Clear In / Out / both | Ctrl+Shift+I / O / X | — | Alt+I / Alt+O / Alt+X |
| 12 | Go to In / Out | Shift+I / Shift+O | Home / End (selection) | Shift+I / Shift+O |
| 13 | Play around | Shift+K | Numpad 0 | `/` |
| 14 | Loop playback | Ctrl+L (monitor) | Q | Ctrl+/ |
| 15 | Add marker | M | M | M |
| 16 | Add marker + edit | M, M | — | Ctrl+M |
| 17 | Add region / chapter | (marker type) | R (region) | — |
| 18 | Selection tool | V | Ctrl+D (Normal tool); D / Shift+D cycle tools | A |
| 19 | Blade / razor tool | C | — (via D cycling) | B |
| 20 | Split at playhead | Ctrl+K (targeted), Ctrl+Shift+K (all) | S | Ctrl+B (Ctrl+`\` split clip) |
| 21 | Ripple edit tool / mode | B | Ctrl+L (Auto Ripple) | T (trim mode) |
| 22 | Rolling edit | N | Ctrl+Alt+drag edge | T + edit center |
| 23 | Slip | Y | Alt+drag | T + drag body |
| 24 | Slide | U | Ctrl+Alt+drag (different meaning) | T + drag name bar; S slide mode |
| 25 | Rate stretch | R | Ctrl+drag edge | Ctrl+R (retime), R (speed dialog) |
| 26 | Track select forward | A (Shift+A backward) | — | Y (track), Alt+Y (all tracks) |
| 27 | Ripple trim previous / next to playhead | Q / W | Alt+[ / Alt+] + Auto Ripple | Ctrl+Shift+[ / Ctrl+Shift+] |
| 28 | Trim previous / next to playhead (no ripple) | Ctrl+Alt+Q / Ctrl+Alt+W | Alt+[ / Alt+] | Shift+[ / Shift+] |
| 29 | Extend edit to playhead | E | — | E |
| 30 | Trim edit mode / toggle trim type | Shift+T | `[` / `]` edge mode; Numpad 5 expanded | T; U cycles side; V nearest edit |
| 31 | Trim ±1 frame | Ctrl+← / → | Numpad 1 / 3 | `,` / `.` |
| 32 | Trim ±many | Ctrl+Shift+← / → | — | Shift+, / Shift+. |
| 33 | Nudge clip ±1 frame | Alt+← / → | Numpad 1 / 3 | `,` / `.` |
| 34 | Slip clip ±1 frame | Ctrl+Alt+← / → | Alt+Numpad 1 / 3 | (trim mode) `,` / `.` |
| 35 | Slide clip ±1 frame | Alt+, / Alt+. | — | (S mode) `,` / `.` |
| 36 | Dynamic (JKL) trim | (Trim monitor + JKL) | — | W |
| 37 | Insert edit | `,` | Ctrl+Shift+V (paste insert); Trimmer A | F9 |
| 38 | Overwrite edit | `.` | — | F10 |
| 39 | Replace / Fit to fill | — / (4-point dialog) | — | F11 / Shift+F11 |
| 40 | Place on top / Append | — | — | F12 / Shift+F12 |
| 41 | Lift | `;` | Delete (time selection) | Backspace (In/Out range) |
| 42 | Extract | `'` | Delete with Auto Ripple, or F after | Delete / Shift+Backspace (In/Out range) |
| 43 | Delete (leave gap) | Delete / Backspace | Delete | Backspace |
| 44 | Ripple delete | Shift+Delete (Alt+Backspace in timeline) | Delete + Auto Ripple (Ctrl+L) | Delete / Shift+Backspace |
| 45 | Ripple cut | — | Ctrl+X + Auto Ripple | Ctrl+Shift+X |
| 46 | Close gaps | — (Sequence menu) | — (Edit ▸ Close gaps) | — (Edit ▸ Delete Gaps) |
| 47 | Paste insert / paste attributes | Ctrl+Shift+V / Ctrl+Alt+V | Ctrl+Shift+V / — | Ctrl+Shift+V **(verify)** / Alt+V **(verify)** |
| 48 | Undo / redo | Ctrl+Z / Ctrl+Shift+Z | Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) | Ctrl+Z / Ctrl+Shift+Z |
| 49 | Snapping toggle | S | F8 (Shift+drag override) | N |
| 50 | Linked selection toggle | — (toolbar) | Ctrl+Shift+U (ignore grouping) | Ctrl+Shift+L |
| 51 | Link / unlink, group | Ctrl+L; Ctrl+G / Ctrl+Shift+G | G / U | Ctrl+Alt+L |
| 52 | Match frame | F (Shift+R reverse match frame) | — | F |
| 53 | Speed / duration dialog | Ctrl+R | — (Event Properties) | R (Ctrl+D change duration) |
| 54 | Freeze frame | — (Add Frame Hold) | — (Freeze Frame at Cursor) | Shift+R |
| 55 | Enable / disable clip | Shift+E | — | D |
| 56 | Default video transition | Ctrl+D | Numpad `/` (cut→transition) | Alt+T |
| 57 | Default audio transition | Ctrl+Shift+D | (crossfade by overlap) | Shift+T |
| 58 | Default transitions (V+A) | Shift+D | — | Ctrl+T |
| 59 | Zoom timeline in / out | `=` / `-` | ↑ / ↓ (wheel) | Ctrl+= / Ctrl+- |
| 60 | Zoom to fit | `\` | — (Ctrl+↑/↓ = large steps or to the selection) | Shift+Z |
| 61 | Track heights (all) | Ctrl+= / Ctrl+- (video), Alt+= / Alt+- (audio) | Ctrl+Shift+↑ / ↓ | — |
| 62 | Maximize panel under cursor | `` ` `` (Shift+`` ` `` active) | Ctrl+F11 (timeline) | — |
| 63 | Full-screen preview | Ctrl+`` ` `` | Alt+Shift+4 (external monitor) | Ctrl+F or P (cinema viewer) |
| 64 | Render preview | Enter (render effects In→Out) | Shift+M (prerender), Shift+B (RAM preview) | Alt+R render cache cycle **(verify)** |
| 65 | Export | Ctrl+M | File ▸ Render As | Deliver page |
| 66 | Save / save version | Ctrl+S / Ctrl+Alt+S (save a copy) | Ctrl+S / Ctrl+Alt+S (incremental) | Ctrl+S (+ live save) |
| 67 | Mute / solo selected track | — (header) | Z / X | — (header) |
| 68 | Multicam angle | 1–9 | 1–9 (Ctrl+1–9 with crossfade) | 1–9 |
| 69 | Clip volume −/+ 1 dB | `[` / `]` | — | — **(verify)** |
| 70 | Keyboard customization | Ctrl+Alt+K | Options ▸ Customize Keyboard | Ctrl+Alt+K |

**Keymap strategy:**
- Ship a **Premiere-style default** (the most-taught layout) with
  selectable **VEGAS** and **Resolve** presets, as DR does with
  PR/FCP/Avid presets.
- Show a visual keyboard map that color-codes app-wide vs. panel-specific
  keys (PR Ctrl+Alt+K) and lists conflicts.
- Panel-context bindings are allowed (PR uses Ctrl+L = Link in the timeline
  and Loop in a monitor).
- Never type chords in UI prose: read them from the keymap (Conventions
  rule 8).

---

## 11. UI patterns that make pro editors feel pro

### Density and information
- **Timecode everywhere:**
  - The program monitor shows **current TC** (left) and **In→Out duration
    or sequence duration** (right).
  - The source monitor shows source TC.
  - Clips can show source TC on hover.
  - The ruler can display timecode, frames, feet+frames (35 mm =
    16 frames/ft) or audio samples.
- **Timecode formats:**
  - SMPTE `HH:MM:SS:FF` (NDF) and `HH:MM:SS;FF` (**drop-frame, semicolon**)
  - absolute frames, seconds.ms, samples
  - VEGAS has the longest list: samples, time, seconds, time & frames,
    absolute frames, measures & beats, feet & frames, and SMPTE Film Sync,
    EBU, Non-Drop, Drop, 30.
- **Timecode entry:**
  - Click the TC field and type digits without separators (`1215` =
    00:00:12:15).
  - `+15` / `-1.00` = relative move by 15 frames / 1 second.
  - Typing with a clip selected moves the clip, and with an edit selected
    trims it (PR and DR).
  - Use the **monospace tabular digits** font.
- **Clip faces:**
  - name, speed badge (`[200%]`), reversed arrow, **fx badge**
    (applied/modified state), keyframe diamonds, opacity/volume rubber band
  - **out-of-sync ±N badge**, offline (red), label color (PR has 16 label
    colors)
  - **duplicate-frame markers** (PR "show duplicate frames": a colored
    stripe when the same source frames appear twice)
- **Thumbnails:** none / head / head and tail / **continuous** (PR, VG and
  DR all offer these modes).
- **Waveforms:** rectified (half-wave, louder-looking) vs. bipolar;
  log/linear scale; waveforms stay visible at small heights. Clip gain
  changes redraw the waveform immediately.
- **Track headers:** lock, **sync lock**, target/patch, eye/speaker
  (output), mute, solo, record (voice-over), name, **height drag**, collapse,
  meter (VG/DR show per-track meters in the header).
- **Render/cache bars** above the ruler. A **dropped-frame indicator.**
- **Edit-point feedback:** the selected edit is highlighted (green/red/yellow
  per side).

### Interaction
- **Every operation has a key, and the mouse is optional.** Editors judge an
  NLE by J/K/L + I/O + `,`/`.` + Q/W in their first 30 seconds.
- **Context cursors** show the trim type before you click (ripple bracket,
  roll double bracket, slip ↔ in a box, slide, rate-stretch clock).
- **Live trim feedback:** two-up/four-up monitor frames, and a tooltip with
  the Δ in frames + the new duration.
- **Hover scrubbing:**
  - Project or media bin thumbnails scrub on hover (PR Shift+H toggle, DR
    live media preview). Skimming with audio is a toggle.
  - The timeline playhead can follow the mouse in skim mode (DR Cut page,
    FCP) as an option, not the default.
- **Scrubby numeric fields:** drag on a value to change it (Ctrl = fine,
  Shift = coarse), double-click to type, right-click to reset, units shown.
  Arithmetic in fields (`+10`, `*2`).
- **Panel maximize** (`` ` ``), dockable workspaces (Edit / Color / Audio /
  Effects / Captions), and saved layouts (VG Alt+D, 0–9).
- **Undo is an edit history,** not keystrokes: each gesture is one undo step
  with a named entry ("Ripple Trim"). Selection changes are not undo steps.
- **Status/hint line** shows what modifiers do for the current hover
  (VEGAS-style).
- **Safe margins / guides / rulers** overlay, a comparison view (split or
  side-by-side, a reference still), and grid overlays.
- **Meters always visible** next to the timeline. The **master meter** shows
  peak and loudness.
- Never block on analysis (stabilize, proxy, waveform, speech-to-text). Show
  progress in a background-task list, as PR and DR do.

---

## Build checklist for Video Editor

Priorities cover pro depth **beyond CapCut**. Basic import, playback,
text and export are assumed.

### P0: without these, pros won't take it seriously
1. **Time base:** integer frames at a rational fps (ADR-004). SMPTE
   timecode incl. **drop-frame** (29.97/59.94) display and entry, with
   relative `+N` / `-N` typing.
2. **Track model:** unlimited V/A tracks; lock, mute, solo, hide; **track
   targeting + source patching + sync lock** with the ripple rules from §1.5.
3. **Linked A/V** with linked-selection toggle, Alt for one side (J/L cuts),
   and **out-of-sync ±N badges**.
4. **Source monitor + three-point editing:** I/O/X, **insert `,` /
   overwrite `.`**, replace, **lift `;` / extract `'`**, backtimed edits,
   4-point fit dialog.
5. **Trim suite:** selection trim, **ripple, roll, slip, slide, rate
   stretch, razor (Ctrl+K / Ctrl+Shift+K)**, **ripple delete**, **close
   gap**, **Q/W**, **extend edit E**, keyboard trim/nudge by 1/5 frames,
   **two-up trim preview**, trim-type cursors.
6. **J/K/L** with speed ramping, K+J/L frame step and slow play, ←/→ frame
   step, ↑/↓ edit navigation, play-around, loop.
7. **Snapping** (pixel radius, priorities, toggle mid-drag) + zoom anchored
   to the mouse/playhead + track height controls.
8. **Markers:** add/edit/navigate, colors, duration markers, chapter-type
   markers → MP4 chapters and YouTube chapter text.
9. **Keyframes:** per-property lanes, **linear / bezier / ease in-out /
   hold**, value graph, copy/paste, clamped evaluation.
10. **Transitions with real handle logic:** center/start/end alignment,
    insufficient-media warning, default transition keys, **audio
    crossfades: equal power + linear**.
11. **Audio:** clip gain + track volume + pan, keyframed rubber bands, fades
    with curve types, **peak meters (dBFS, peak hold)**, **LUFS measurement
    + normalize-to-target** (−14 YouTube default) and export loudness
    normalization.
12. **Color:** Basic correction (WB temp/tint, exposure, contrast,
    highlights, shadows, whites, blacks, saturation), RGB curves +
    **hue-vs-sat**, **.cube 3D LUT** (tetrahedral), **waveform /
    vectorscope / histogram / RGB parade**; correct **limited/full range +
    601/709 matrix** handling and output tagging.
13. **Playback resolution Full/½/¼** + **proxy generation and toggle** +
    dropped-frame indicator + a render-cache bar (red/green).
14. **VFR detection** and timestamp-based presentation, with a conform-to-CFR
    offer.
15. **Autosave with versions + crash recovery + "Save version",** and an
    **offline-media relink dialog** (relative path + fingerprint
    auto-relink).
16. **Keymap:** Premiere-style default, full rebinding, conflict display;
    every action reachable by keyboard.

### P1: real pro depth
1. Nested sequences / compound clips (with cycle detection), adjustment
   layers.
2. Multicam (sync by audio/TC/In, cut with 1–9, flatten).
3. Trim edit mode with **dynamic JKL trimming**, four-up slide view, edit
   point selection (V/U-style).
4. **Time remapping / speed ramps** (speed curve UI), frame blending and
   **optical flow** (desktop), reverse, freeze frame (hold / insert hold
   segment).
5. **Masks:** ellipse/rect/bezier, feather, expansion, invert,
   keyframes, **tracking**. **Chroma key** with despill and matte view.
   **Stabilization** (analysis per source).
6. Full **blend mode** set (W3C formulas), opacity keyframes, VEGAS-style
   Pan/Crop (inverse crop rect) and Ken Burns presets.
7. **Color:** lift/gamma/gain/offset wheels, the full hue/sat/lum curve
   family, **HSL secondary** with mask view, vignette, LUT Strength, look
   browser with thumbnails, scope options (IRE / mV / 10-bit scales, 75 %
   targets, skin line).
8. **Audio track mixer** with inserts, sends, busses and **automation modes
   (read/latch/touch/write)**; parametric EQ, compressor/limiter, gate,
   de-esser, denoise; **ducking**; true-peak meter; BS.1770 loudness meter
   (M/S/I/LRA).
9. Speed graph + on-canvas motion paths (spatial bezier, arc-length timing).
10. **Interchange:** **FCP7 XML export**, **EDL CMX3600 export**, **OTIO
    import/export**, SRT/VTT import/export.
11. **Project manager:** collect / trim with handles / transcode.
12. **Smart "trim-only" export** (GOP stream copy) on desktop. ProRes /
    DNxHR export on desktop.
13. VEGAS-style **overlap = crossfade** mode and an Auto Ripple scope
    selector (affected tracks / + markers / all tracks).
14. Duplicate-frame indicators, a timeline index (list of clips/markers),
    find in timeline.

### P2: high end
1. Color-managed linear pipeline (OCIO/ACES), log camera IDTs, **HDR PQ/HLG
   grading + HDR10 metadata** export; node-based grading; CDL interchange.
2. AAF, FCPXML, FCP7 XML import, CSV/ALE metadata.
3. Collaboration: bin/timeline locking, cloud project sync, review comments
   on frames.
4. 5.1/7.1 surround mixing and panner; Fairlight-level editing (comping,
   ADR).
5. AI frame interpolation (Speed Warp-class), AI object masks, voice
   isolation (see [[AI and automation]]).
6. Interlaced output, IMF/DCP, broadcast-safe limiter, closed-caption
   formats (SCC/MCC).
7. Graph editor parity with AE (separate dimensions, roving keys,
   expressions).

---

## Pitfalls

- **VFR footage:** phone and screen recordings drift if they're treated as
  CFR. Present frames by timestamp, never by `index / fps` (§8.2).
- **Drop-frame timecode:** DF *labels* skip frame numbers ;00 and ;01 every
  minute except minutes divisible by 10. 59.94 DF skips 4 labels (;00–;03).
  No frames are dropped. Frame→TC at 29.97 DF:
  ```
  D = f div 17982;  M = f mod 17982
  f' = f + 18*D + 2*max(0, (M - 2) div 1798)
  FF = f' mod 30; SS = (f' div 30) mod 60; MM = (f' div 1800) mod 60; HH = f' div 108000
  ```
  For 59.94 DF, use 35964 / 3596 / drop 4: `f + 36*D + 4*max(0,(M-4) div
  3596)`, with 60 fps fields. 23.976 has **no** drop-frame, so its TC runs
  0.1 % slow vs. the wall clock (3.6 s/hour).
- **Fractional rates:** store 30000/1001, 24000/1001 and 60000/1001 as
  rationals. A float 29.97 drifts by about a frame every ~9 hours, and worse
  in seconds-based math.
- **Audio/video drift:** at 29.97 fps and 48 kHz a frame is **1601.6
  samples**. Use the 5-frame cadence 1602/1601/1602/1601/1602 (= 8008), or
  better, derive sample positions from rational time and never accumulate
  per-frame. A 44.1 kHz source in a 48 kHz project needs resampling, not
  reinterpretation.
- **AAC priming / edit lists:** MP4 `edts`/`elst` and encoder delay (1024
  or 2112 samples) offset audio. Honor edit lists, or sync slips by ~20–45
  ms. B-frame reordering makes PTS ≠ DTS, so sort by PTS.
- **Color range:** treating a full-range phone clip as limited crushes
  blacks and clips whites. The reverse gives washed-out output. Read the
  `color_range` flag and allow an override. Export tags must match the
  pixel data.
- **Matrix and tags:** use BT.601 for SD and BT.709 for HD. Untagged
  ≥720p → assume 709. Tag output 1-1-1. The macOS QuickTime gamma
  difference (≈1.96 vs. 2.4) is not our bug, but users will report it.
- **Rotation and PAR:** phone MP4s carry a rotation matrix (portrait
  footage). Anamorphic and SD DV have non-square pixels (e.g.
  10/11, 40/33). Ignoring either distorts the image.
- **Start timecode:** DR timelines start at **01:00:00:00** by default, while
  PR sequences start at 00:00:00:00. Camera files carry their own start TC.
  Interchange (EDL/XML/OTIO) breaks if record or source TC offsets are
  ignored.
- **Transitions without handles:** decide and show the behavior (hatch +
  freeze-repeat, or refuse). Never silently shift the cut.
- **Bezier overshoot:** clamp evaluated values (opacity, scale, volume). Use
  monotonic tangents for auto-bezier at extremes.
- **Unquantized edges:** any operation (fps change, speed change, audio
  sample edits) that leaves an edge off the frame grid produces 1-frame
  blends or flashes. Re-quantize, or flag it as VEGAS does.
- **Long-GOP reverse/scrub:** H.264/HEVC reverse playback needs GOP decode +
  backward emission and a frame cache. Seeking needs keyframe-aware
  prefetch. Generate intra proxies for heavy footage.
- **Loudness after encode:** AAC can add inter-sample peaks. Measure true
  peak and leave −1 dBTP headroom (−2 for broadcast). VEGAS logs loudness
  *before* the codec.
- **Equal-power on correlated audio:** an equal-power crossfade between two
  halves of the same clip produces a +3 dB bump. Use linear there.
- **Effect order surprises:** PR applies Motion after standard effects.
  Pick an order, show it in the UI, and let users reorder transform.
- **Mixed frame rates on one timeline:** pick nearest-frame by default and
  make blend/optical flow explicit per clip. Show a badge when a clip's fps
  ≠ the sequence fps.
- **HEVC 10-bit 4:2:2:** hardware decode support is patchy (NVIDIA only
  recently, with Blackwell). Fall back to software and suggest proxies.
- **Paths:** store project-relative paths. Mapped drives vs. UNC paths
  (Premiere requires mapped drives for growing files) and long Windows paths
  break relinking.

---

## Sources

- VEGAS Pro 2026 online help (Boris FX, modified 2026-04-15):
  - [keyboard shortcuts](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/13-appendix/shortcutkeys.htm)
  - [Pan/Crop animation](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/7-edit/pan-crop-animation.htm)
  - [keyframes](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/8-design/keyframes.htm)
  - [compositing and masks](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/8-design/compositingandmasks.htm)
  - [slip and slide](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/7-edit/slipping_and_sliding_events.htm)
  - [post-edit ripple](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/7-edit/post_edit_ripple.htm)
  - [smart rendering](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/10-export/smart_rendering.htm)
  - [project properties](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/3-projects/project_properties.htm)
  - [editing preferences](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/12-preferences/prefediting.htm)
  - [advanced save](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/3-projects/advancedsave.htm)
  - [proxies](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/5-preview/creating_intermediate_files.htm)
  - [import/export projects](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/3-projects/importing_and_exporting_projects.htm)
  - [specifications](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/1-before/specifications.htm)
  - [scrubbing](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/7-edit/scrubcontrol.htm)
  - [panning modes](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/9-audio/audio_panning_modes.htm)
  - plus the 8-bit pixel format, LUT, chroma keyer, stabilization,
    loudness, freeze frame, reverse and nested timelines pages.
- Adobe:
  - [Premiere default keyboard shortcuts](https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html)
    (read via the archived copy of the Premiere Pro page)
  - [Supported file formats](https://helpx.adobe.com/premiere/desktop/get-started/technical-requirements/supported-file-formats.html)
    (updated 2026-01-07)
  - [Premiere release notes](https://helpx.adobe.com/premiere/desktop/whats-new/release-notes.html)
  - [Playing assets (J/K/L)](https://helpx.adobe.com/premiere-pro/using/playing-assets.html)
- Blackmagic:
  - [DaVinci Resolve 20 Supported Codec List (July 2025)](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_Supported_Codec_List.pdf)
  - Resolve 21 coverage: [CineD](https://www.cined.com/davinci-resolve-21-announced-new-photo-page-eight-new-ai-tools-tethered-camera-controls-and-more/),
    [No Film School](https://nofilmschool.com/davinci-resolve-21)
  - Resolve keymap reference: [jayaretv](https://jayaretv.com/tips/davinci-resolve-keyboard-shortcuts/)
- Industry news:
  - [Boris FX acquires VEGAS Pro (CGPress)](https://cgpress.org/archives/boris-fx-acquires-vegas-pro-sound-forge-and-acid-pro-releases-vegas-pro-2026.html)
  - [Premiere 26.0 (Newsshooter)](https://www.newsshooter.com/2026/01/20/whats-new-in-adobe-premiere-pro-26-0/)
  - [Premiere 26.2 (Larry Jordan)](https://larryjordan.com/articles/new-features-in-adobe-premiere-26-2/)
- Loudness targets, cross-checked:
  - [Delivery specs cheat sheet (ThePostFlow)](https://thepostflow.com/filmmaker-resources/delivery-specs-cheat-sheet/)
  - [Dialogue loudness (Joseph Nilo)](https://josephnilo.com/blog/dialogue-loudness-lufs-true-peak-video/)
- Community, for the AV1/VP9 status in Premiere:
  [WebMiere importer (Creative COW)](https://creativecow.net/webmiere-adds-native-vp9-av1-webm-mkv-import-to-adobe-premiere-pro/)
