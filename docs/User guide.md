# OpenFrame user guide

OpenFrame is a desktop-first video editor in active development (named
"Video Editor" until 2026-10-17).

## Get the editor

The source is public at github.com/gAlexander77/openframe; there is no
packaged release yet. Follow the root README's source setup and run
`npm run tauri dev` in the `openframe-application` folder. Node.js/npm, Rust, and the platform's Tauri prerequisites
are required. Install FFmpeg and ffprobe on `PATH` for the desktop's broader
media-format support. `OPENFRAME_FFMPEG` points the app at another FFmpeg
(the older `VIDEO_EDITOR_FFMPEG` still works).

Use `npm run dev` to try the secondary browser build at
`http://localhost:1420`. Browser support and codecs vary by device; desktop
is the development priority. Read [[Features]] for the current feature map
and [[Roadmap]] for what is still planned.

## Make your first edit

On desktop, drag any noninteractive part of the top header to move the
window, including the logo, save status and spaces between controls.
Double-click the same areas to maximize the window; double-click again to
restore its previous size. Menus, project renaming and buttons keep their
normal actions. The maximize button changes to a Restore button while the
window is maximized. Clicking a window control keeps your typing focus, so
resizing does not submit an unfinished project rename.

1. On the home screen, create a project and choose a canvas preset if you
   know the destination format. Otherwise, the first clip can establish the
   canvas size and frame rate on an empty timeline.
2. Import your own video, audio, or images with the media picker or by
   dropping files into the app. Dropping onto the timeline also places them.
   What a file is comes from the file itself: its extension, or its
   contents when its name has none. A file that cannot be imported says why.
3. Arrange clips on the timeline. Drag to move them, drag an edge to trim,
   and use the toolbar or context menu to split. The magnet keeps the main
   track gapless; snapping helps align edits, and linkage makes overlays
   follow their shots through ripples.
4. Select a clip to adjust its visual or audio properties in the inspector.
   Add text or captions as needed. Double-click a title or caption in the
   viewer to edit its text on the canvas. Undo is available for edits.
5. Play the timeline and review the picture and sound, check it (the
   library's **Check** tab, below), then open Export.
   Choose from the formats and codecs the current platform can encode.
   Select the output destination when offered, or use Download when the
   browser's export workflow provides it. Play the exported file to check it.

In the inspector, one drag of a slider (or holding an arrow key on it) is
one Undo step, and so is dragging in a color picker. A typed value applies
when you press Enter or leave the field, including by clicking another
clip; Escape puts the old value back. An empty or non-numeric entry
changes nothing, and a decimal comma works ("1,5" is 1.5). Sections stay
open or closed as you left them, across clips and reloads. A section with
a switch in its header (Border, Shadow, Colorize, a title's Glow) opens
when you switch it on, so its settings show.

To soften a picture's crop, open **Video > Basic > Crop** and raise
**Softness**, or use the Softness slider beneath the viewer in crop mode.
Done applies the crop and softness together; Cancel drops the draft. The
soft edge stays inside the crop, so it reveals the pictures underneath.

**Transform > Rotate** has a dial beside its number. Drag around its center
(Shift snaps to 15 degrees), type an angle, or focus the dial and use arrows
for one degree (Shift for ten). It keeps complete turns, has the usual
keyframe diamond, and resets on double-click.

For a custom cutout, open **Video > Mask > Pen**. Click anchors around the
region to keep; drag while placing an anchor for a curved edge, and click
its first point to close. Drag a point or one of its round handles to refine
it. Alt-click a point for smooth or corner; Delete removes the selected
point. Choosing Pen again starts a new path. Position, size, rotation,
Feather and Invert affect the whole path; key the numeric controls to move
it over time. Individual anchors do not animate.

To grade one region, add an **adjustment layer**, open its **Mask** tab, and
choose a circle, rectangle or Pen path on the canvas. Set its exposure to
darken a sky, or add Blur to soften a face. Only the masked region receives
the adjustment's grade and effects. Feather softens the boundary and Invert
applies the change outside. Adjustment masks use the whole canvas as their
coordinate frame, and their numeric controls take keyframes too.

The inspector fits any width its splitter gives it. Narrower than about
340 px, each slider takes a line of its own, with its keyframe buttons,
under its label and number; a choice that no longer fits beside its label
(the audio channels, the reverb presets, a color) moves under the label
instead of wrapping in place. A long name in a list (a LUT, a font, a
logo) ends in "…" and shows in full when you point at it. A number
shows as many decimals as its slider moves by (a letterbox ratio of
2.39:1 reads 2.39). The easing menu opens above its button when there is
no room below.

In a clip's **Animation** tab, each preset tile pictures its motion: the
layer where it settles and a dashed outline where it starts (In), ends
(Out) or swings to (loops); hover a tile to see it move. Picking one plays
that part of the clip once in the viewer, silently, and stops.

A title template (Text tab) lands on rows of its own above your footage,
never on a B-roll row, and its layers are grouped: they select and move
together. Alt+click one layer to edit it alone.

Export presets name where the video goes. **TikTok, Reels and Shorts** is
made for a 9:16 canvas; on another shape the dialog says what size will be
exported (a 16:9 project stays 1920×1080) and offers **Make the canvas
9:16**. The canvas changes only when you click it, and Undo restores it.
When a mix is normalized to its loudness target, the finished export says
so in green; an amber note means something did not go as asked.

For the sound alone, turn **Video** off and choose MP3, AAC (M4A) or WAV,
or pick the **Audio only (MP3)** preset. When the project has captions,
the **Captions** row decides what becomes of them: burned into the
picture (as you see them), an **SRT file beside it** for YouTube and other
sites that take one (the picture stays clean), both, or none. The SRT
matches the exported range. The desktop app saves it next to the video
with the same name; the browser version downloads it.

Under the player, the outer buttons jump to the start and the end of the
timeline, and the inner ones step a frame. Drag the playhead along the
ruler to hear short snippets of the sound under it, to find a word or a
beat by ear; turn this off in **Preferences** under Playback. The gear at the top right opens
**Preferences** (also on Home); the keyboard beside it lists the shortcuts.
The app's shortcut panel is the source for the current keyboard bindings.
[[Features]] explains the deeper trim, color, keyframe, and audio tools.

**File → New project** saves the current project and creates a new one.
A new project is kept once you do something in it: create a project and
go back to Home straight away, and no empty project is left behind.
**File → Open project** saves the current project, returns to Home and
focuses Search projects; select a saved project card to reopen it. Open also
focuses search when you are already on Home. The project shortcuts shown in
the shortcut panel use these same actions. Home ignores editing/playback
shortcuts so they cannot change a closed project.

If saving fails, New, Open and Back to home keep the current project open
with its edits. Resolve the storage problem and retry; a failed save does
not show a successful-save notification.

Edits made while a save is running are saved before navigation completes.
While a project is opening or the old one is being saved for a switch,
repeated navigation requests are ignored. Home shows **Opening project…**
and disables creation/deletion during loading; retry after it finishes.
A focused project card opens with Enter or Space; its Delete button never
opens it. Right-click a card for **Open**, **Rename…**, **Duplicate** and
**Delete**. **List view**, beside Search projects, shows each project as a
row with its canvas size, length and last edit; Home remembers which view
you chose.

Deleting a project moves it to **Recently deleted** at the bottom of Home,
and the notice that says so has **Undo**. A deleted project waits there
for 30 days: open the section to **Restore** it (it returns to its place)
or **Delete forever** (click twice; this cannot be undone). After 30 days
it is deleted for good. Your media files are never deleted.

Closing or switching projects cancels unfinished captions/analysis and
discards late import results. Reopening the same project starts a new session;
restart unfinished work there. A movie export already in progress may finish
from its original project snapshot.

Choose **File → Save a copy…**, give the version a name, and choose whether
to open it after saving. The original saves first and remains independent:
later edits to either version do not change the other. Both reference the
same footage, so keep those media files available. A project copy is not a
backup of the footage. Save errors keep the dialog open for retry.

## Find and reuse imported media

In **Media**, combine Search media with **All types**, **All usage** and
**All folders** to find video, audio, images, used or unused files, or one
folder's files; the heart beside the view buttons shows **Favorites only**.
**Clear filters** shows all imports again. **Audio** uses the same browsing
controls but only shows audio files. Stickers remain in their separate tab.
Before anything is imported, the tab shows only Import (and Record).

In a narrow or short library (a small window, the library splitter pulled
in, or the AI assistant open beside the editor) the tabs show their icons
alone; point at one, or focus it, for its name. In the narrowest library,
the categories of Text, Stickers, Effects, Transitions and Filters move from
the side column to a row above the cards.

Choose **Import order**, a name sort, or shortest/longest source duration.
Name sorting puts numbered shots in natural order (Shot2 before Shot10).
Images have no fixed source duration, so they sort after timed media in
both duration directions. Sorting never rearranges timeline clips.

Switch to **List view** beside the file count to see duration, dimensions,
frame rate and file size when available, with the folder, the timeline uses
and Preview on one line under them. Click a **timeline uses** count
to select every referencing clip and seek the earliest one. Counts include
disabled clips and references on hidden, muted or locked tracks; **Unused**
means no timeline reference. It does not remove any source files.

To rename a file in the project, right-click its card and choose
**Rename…**, or in the grid view double-click its name; Enter keeps the new
name and Escape the old one. The file on disk keeps its own name, and clips you have not
renamed show the new one.

Drag a row, double-click it, or use its Add button to place media, just as
with the grid. Search/filter/view choices survive tab changes. Opening or
creating a project clears search/type/usage filters; view and sort last for
the app session. Browsing and selecting uses do not consume Undo steps.

## Edit heavy footage with playback proxies

On desktop, right-click a video card and choose **Create proxy**, then
**Half** (the default), **Quarter**, or **720p** (720 pixels on the short
side). To make a batch, check several video cards and right-click one of
them. A progress toast names each file; **Cancel** stops the remaining work.
Completed copies are added as one undo step. FFmpeg with libx264 must be
installed for this conversion.

The card's **P** badge and tooltip show the proxy's state, size and dimensions.
**P...** means making; **P!** means stale or missing. **Manage media** lists
that information and offers **Create proxies for all 4K and HEVC media**
(also including ProRes). An import hint offers proxies once per heavy import
batch. **Delete proxy** removes the cached file and reference. Undo restores
the reference, and the missing copy can be recreated.

Use **Proxy playback** in the player's toolbar or **View** to compare the
original and proxy without reopening the project. The choice is remembered;
it starts on. Export, saved frames, AI review and analysis always use the
original or its full-resolution decode fallback. Scopes switch the viewer
to that source while open. Missing copies, including on another computer,
and copies made from an original that changed or was relinked are ignored.
The browser build offers the controls but clearly says proxy generation and
deletion are desktop-only.

## Select and arrange clips

Click a picture in the viewer to select the top unlocked clip whose box
contains the pointer. Clicking empty canvas or stage space clears selection.
Hidden and locked tracks do not intercept the click.

With the main track magnet on, drag a clip to the start to make it the first
shot. Linkage carries short titles and sound effects with their shots;
a music bed covering two or more complete shots stays at its timeline time.

Adding a title or sticker briefly previews its In animation, then restores
the playhead. Reduced motion skips that preview. Pausing a preview stops it
without a later jump back.

Right-click a clip for the everyday edits in one place: Ripple delete,
Split, **Speed…** (opens the Speed tab), **Reverse** (shows a check while
the clip plays backward), **Copy effects** and **Paste effects** (onto
every selected clip), Rename, Ungroup and Duplicate, among others.

**Deactivate clip** in the same menu (or its shortcut, V by default) turns
the selected clips off: they stay in place, hatched, and preview and
export skip them. With some clips off and some on, it turns them all off;
when every selected clip is off, the menu reads **Activate clip** and
turns them all back on. Undo names which it did.

Name a clip with right-click > **Rename…**, or double-click the name on
its strip (a title's double-click edits its words, so use the menu for
titles). Clear the name to show the file's name again.

Add a transition between touching clips, or click its timeline marker, to
open **Transition** settings. Undo history gives agent edits readable names
such as **Add clip**, **Change opacity** and **Change border width**.

A title an AI agent gave a drop shadow, a border or a colorize shows them
in its **Text** tab (as **Drop shadow**, **Border** and **Colorize**), where
you can change them or switch them off.

## Match and compare color

Select a video or picture and open **Adjust > Match color**. Choose
**Pick reference**, then click the timeline clip whose look you want. The
selection stays on your targets; Escape cancels picking. Adjust Strength
and **Match saturation**, then choose **Match**. Select several targets to
match them together in one Undo step. **Cancel match** discards the work.
Matching replaces the targets' other look settings with editable red,
green and blue curves and Basic saturation; it preserves the master curve,
placement, crop, opacity and chroma key. Strength zero leaves everything
unchanged. Similar subjects match best; clipped tones cannot be recovered.

Turn on **Compare** in the Player header to see the selected clips before
and after their look. Open **Comparison options** to choose **Reference
frame** or **Capture reference**: the captured picture stays on the left
while the live viewer follows the playhead on the right. Choose a vertical
or horizontal split, drag its handle to move it, and double-click the
handle to center it. Arrow keys move a focused handle, and Home/End put it
at an edge. Turn Compare off to release the captured picture. Compare is
only for this session and has no effect on exports or Undo.

Agents can call `match_color` with `reference_clip_id`, target `clip_ids`,
`strength` and `match_saturation`. For an ungraded preview without an edit,
use `preview_frame` or `preview_frames` with `before: true`; optional
`before_clip_ids` limits the bypass to those clips, otherwise every visible
look, including adjustment layers, is bypassed.

## Apply transitions at several cuts

Set **Default video transition**, **Transitions** seconds and **Audio
crossfades** seconds in Preferences. In the Transitions library,
right-click a card and choose **Set as default**; its Default badge marks
it. The starting choices are Dissolve, 0.5 s for video and 0.5 s for audio.

Select the clips before the cuts, then choose **Timeline > Apply default
video transition** or **Apply default audio crossfade**. The Keyboard
shortcuts panel lists their keys. One Undo removes the whole application.
With no selection, the nearest eligible main-track cut is used. On audio
tracks, select the outgoing audio clips; the incoming clips need sound
before their in-points. Gaps and locked tracks are skipped, existing
transitions stay, and each new length shortens to fit the join.

## Compose with viewer guides

Choose **Safe margins**, **Rule of thirds**, or **Safe margins + thirds**
from the Player header's guides selector or the View menu. The action box
encloses 93% of the canvas dimensions and is labeled at its top; the title
box encloses 90% and is labeled at its bottom. Use them to keep text away
from edges and balance a shot. They are general guides,
not platform-specific safe-area requirements.

Guides follow the picture when resizing, using a portrait canvas or entering
full screen. They do not block editing handles, appear in exports, change
the project or consume an Undo step. The choice lasts for this app session;
choose **Guides off** to hide them.

## Find a clip on the timeline

Open the library's **Timeline** tab beside Markers. Search a clip's name,
its media name, its text (including a title's later lines), or its kind.
Filter by Video, Audio, Text, Captions, Pictures or Other, and sort by
Start, Name or Track. Rows show the track, start timecode, duration and
color label; deactivated clips are dimmed.

Click a row to select its clip, jump to its start and bring it into view.
Up and Down move through rows; Enter selects the focused row. Selecting
on the timeline highlights the matching row too. Double-click a compound
row to open it; the list then follows that compound's own timeline.

## Organize edits with markers

Open **View → Markers**, **Timeline → Manage markers**, or the library's
**Markers** tab. **Add marker** places a note at the playhead. Click a row
to jump to it and edit its note, position and color; choose **Save marker**
to apply all changes in one Undo step. Cancel discards the draft. Position
accepts timecode or seconds with `s`, such as `12.5s`, rounded to the nearest
project frame. Invalid timecodes cannot be saved.

Search matches note text or displayed timecode; the color filter narrows
that list. Ruler flags remain visible while searching. Previous/Next moves
through all markers. Double-click a flag to open its editor, or use the
list's trash button to delete it. Undo restores a deletion. The shortcuts
panel lists marker navigation bindings.

Markers you add keep their timeline positions when clips move. A song's
markers (its beats, bars, parts and drop, from **Beat markers** in AI
tools, the Beat grid or an agent) follow their clip instead: the list
names the clip after the marker's time, with a link icon, and they move
when the song is moved, trimmed, split or sped up. **Detach** (the
broken-link button on such a row) makes one stay where it is, like your
own; giving it a new position does the same. Searching a clip's name
lists the markers that follow it. Notes beyond the last clip are
reachable and appear in the list, but do not make the exported movie
longer. Editing markers leaves clips, gaps and clip selection alone.
Saved markers reopen with the project. Set **Duration** with the same
timecode or seconds rules as Position (zero makes a point marker). A range
draws a band on the ruler; drag its right end to resize it in one undo step.
Its start keeps following its clip when attached; changing only Duration
does not detach it. Turn on **Chapter** to include its start and note in an
MP4 export with **Chapters from markers** enabled. Only chapter-marked notes
are included. Partial exports start the preceding chapter at zero.
MP4 supports up to 255 chapters, and titles use at most 255 UTF-8 bytes.
Chapter exports put their movie metadata at the end of the file.

Use **Export shown markers** to preview and save just the notes shown by
the current search and color filter. **Timecoded notes** keeps frame-exact
positions; **YouTube chapters** uses whole-second timestamps. The export
preview can be selected and copied with your normal text-copy shortcut.
**Save text** uses the platform's save picker or browser download fallback.

Chapter checks flag a missing `00:00` start, fewer than three chapters,
duplicate timestamps, markers at/past the movie end, and chapters shorter
than ten seconds (including the last). You can still save a draft and fix
its markers later. Names without notes become numbered chapter titles.
Times refer to the full timeline, even if an export In/Out range is set;
chapter timestamps round down to whole seconds. This saves a text file for
your video description; chapter display also depends on the destination's
requirements. [YouTube's chapter guidance](https://support.google.com/youtube/answer/9884579?hl=en).

## Check the edit before you export

The library's **Check** tab reviews the edit against the rules
professional editors keep, the same check an AI agent runs: text that
runs past the title-safe area or under TikTok, Reels and Shorts buttons,
text too small for a phone, on screen too briefly to read, or hard to
read against the picture behind it (measured on the rendered frames),
captions too fast, more than two fonts, a title hidden behind its
subject, strobes that flash too fast, black gaps on the main track,
music that stops dead at the end, sound cut off mid-sound, and a click,
a dropout or a sound cut off where one audio clip meets the next (each
join is played on its own track and measured; its fix is a crossfade
from the clip menu). Choose
what you are making under **Made as**: an **Ad** also asks for an end
card, a **Social short** sizes text for a phone, **Cut to music** checks
that the cuts land on the beat. **File → Check project…** opens the tab
and checks.

**Check project** measures the picture and the sound, so it runs only
when you ask, with its progress shown; Cancel stops it. The findings are
grouped as **Text**, **Timing** and **Sound**, with a count for each and
a summary that says whether anything must be fixed before you export.
Each says what is wrong, what was measured, and what to change in the
app ("Raise Size in the Text tab to 49 or more"). Click one to go to it:
the playhead moves to its time, its clip is selected and the inspector
opens on the tab with the fix. After you change something the tab says
the check is out of date; **Check again** checks once more.

The Export dialog's **Check** row shows what the last check found;
**Review** opens the tab, and **Check project** (or **Check again**, after
changes) checks first. The check never stops an export. It does not
measure loudness: choose a **Loudness** target in Export, or run
**Normalize loudness** in AI tools.

## Manage effects

Select a visual clip or adjustment layer on the timeline, then open the
right-hand inspector's **Effects** tab. Its count shows how many effects
are attached. Use the eye to enable/disable an effect, or its trash button
to remove it; Undo restores a removed effect. Filters and color correction
remain under **Adjust**. Inspector tabs wrap when space is narrow.

Effects run from top to bottom. Use the up/down arrows to change their
order, or Reset to restore one effect's defaults and clear its keyframes.
**Disable all / Enable all** sets the whole stack off/on; Undo restores a
previous mix of enabled and disabled effects. **Remove all** clears the
stack and its effect keyframes in one undoable step. Color grading,
transforms and their keyframes are retained. Unlock a track before editing
its effects. Text and caption clips have the same Effects tab.

To reuse a stack, choose **Copy effects**, select another clip, and choose
**Paste effects** in its Effects tab. For several selected clips, use
**Paste effects to N clips** in the Selection inspector. It appends effects
and their keyframes to unlocked visual clips; audio and locked clips are
excluded and the count reflects that. Existing effects, grading, transforms
and timing stay intact. One Undo reverses the whole paste.

This clipboard lasts for the current app session and is separate from
normal clip/keyframe copying. Animation keeps its timing relative to the
clip's beginning, including when copied between projects with different
frame rates. Keys beyond a shorter clip's end are retained so the visible
part of an animated effect keeps the same interpolation.

## Where your work lives

**Desktop:** project JSON and home-screen summaries are saved in the app's
data folder. Saves keep a previous project version as a `.json.bak` file.
Imported media is referenced by its path, so keep the original files
available. Autosave does not make a portable backup of all source footage.

**Browser:** locally imported media and project JSON are kept in the origin private
file system (OPFS) for that browser profile and site. Clearing site data,
changing the site origin, or switching profiles can make those projects
unavailable. Storage failures can leave imported files usable for the current
session without keeping them for a reload. Keep independent backups of your
original media and important project data.
Media imported by its address (through automation) is copied into the same
storage, so the project keeps working when the address goes away; a file
over 1 GB stays linked to its address, and the app says so when it is
imported. See [[Web capability log]].

The OpenFrame rename must preserve existing saved work. Its migration plan
is in [[Renaming]]. The project format itself is documented in
[[Project format]].

## AI features and automation

Manual editing does not require an AI coding agent. The editor's optional
features include auto captions, local analysis, and the AI assistant. Some models or
tools need a separate download or installation; local inference can still
require network access to obtain model files. The current AI assistant uses a
local model server such as Ollama or LM Studio.

**Find the moments in a stream:** import the VOD, place it on the timeline,
then open **AI tools > Find highlights**. Choose the media and optionally
**Choose chat replay** (TwitchDownloader/Twitch JSON, chat-downloader JSON
or JSONL, or timestamped text, up to 32 MiB). Set Count and the minimum and
maximum seconds, then Run. Cancel stops a reading. The first pass streams
the audio; repeat runs reuse its features. Scores suggest moments to
review, not guaranteed highlights: music and game sounds can resemble a
shout. Select a result to seek or use its Play button. **Add markers** adds
all results as Highlight N ranges following that source clip, one undo step;
rerunning replaces those ranges. A range follows its start through edits.
Turn on **Hear candidates** for local Whisper quotes and sentence boundaries;
only candidates plus five seconds of context are heard, and first use may
download a speech model. Agents use `find_highlights` (source-second times,
optional viewer clip times and transcript keywords), `preview_media` to
review, and `add_highlight_markers` to mark a reviewed reading.

**Remove a background:** select a video clip, open Video > Remove BG and
turn on Auto removal (or use the AI tools card). The first time downloads
the model (88 MB, or 0.5 MB on a computer without a capable GPU); after
that it works offline. A bar shows progress and Cancel stops it. When it
finishes, the person plays over whatever is on the tracks below. Turning it
off and on again is instant.

**Read a title aloud:** select a title, open Text > Text to speech, pick a
voice, a pace and a quality, and click **Add voice**. The voice is made on
this computer and lands on an audio track where the title starts; one
Undo removes it and its file. Best quality downloads the full speech model
(325 MB) the first time; Draft downloads a smaller one (92 MB). Normal
pace is a narrator's 2.3-2.8 words a second (Slow and Fast move it half a
word): the app reads the title, measures it and reads it again at the
speed that lands it there, so short words are not rushed. Voices come
with natural pauses, one level, and a quiet room under the silences.

**Caption a voice:** the Captions tab's **Generate captions** hears the
timeline on this computer. A voice made by the app (Text to speech, or an
agent's voiceover) is captioned in the words it was given to read, at the
times it says them, so a word the recognizer mishears never reaches the
captions. An agent can call `auto_captions` after the cuts: whole lines by
default, or `words_per_caption: 2` and `look: "pop"` for a short. Set
`start`/`end` to caption a stretch, `track_ids` to choose the speech tracks,
and `replace: false` to keep earlier captions. Imported audio intended as
speech should have the Dialog role; music and effects roles are skipped.
`detail: "full"` lists the caption times. This is one undoable edit.

**Ask the AI assistant for an edit:** click **AI assistant** in the title
bar. It opens as a column at the right of the editor, which makes room for
it (in a window too narrow for four columns the media library steps aside
until you close it; in a browser window narrower than 1066 px it floats over
the editor's right side instead); drag its left edge to resize it. Pick the model server
and model at the top, type what you want in the box at the bottom and
press Enter to send (Shift with Enter starts a new line). The box grows as
you type. While the model works, the steps it takes appear as they run;
**Stop** ends the turn. Each answer that changed the timeline has an
**Undo** button for all of its changes at once, and a failed request can be
tried again. The examples in an empty conversation fill the box for you.

**Connect Codex or Claude Code (desktop app):** open the AI assistant's
**Connect agents** tab and turn on **Allow AI agents**. Then click **Add to
Codex** or **Add to Claude Code**: the app asks that program to add
OpenFrame to its settings and tells you whether it was added, was already
there, or the program was not found (with a link to install it). You can
also copy the ready-made command or, for Codex, the `config.toml` entry.
Start a new Codex or Claude Code session afterwards, and keep OpenFrame
open with Allow AI agents on while the agent works. After updating
OpenFrame, an agent added with the button sees the new tools by itself;
one connected over HTTP (the copied command) needs a reconnect: in Claude
Code, type `/mcp`, choose openframe and Reconnect.

While an agent (or the docked assistant) works, each change it makes is
named in a notice at the top of the window, marked **AI agent** with the
robot icon, so you can tell its edits from yours; your own notices stay at
the bottom. Every change it makes is undoable like your own.

External agents connect only after the user enables "Allow AI agents".
[[Automation]] explains the controls, MCP connection (with step-by-step
Codex CLI and Claude Code setup), headless rendering, and the `openframe`
command line. [[AI tools]] records the algorithms and limits.

## Generate music

Open the library's **Audio** tab: under your audio files, the **Generate
music** card makes an original score on your computer, free to use.

1. Pick a **Style** (Product launch, Cinematic, Upbeat corporate, Lo-fi
   chill or Ambient); the line under it says what it sounds like.
2. Set the **Length** in seconds. **Tempo** and **Key** are optional (each
   style has its own); **Ending** rings out or stops on a final hit.
3. **Preview** renders it (a few seconds) and plays it; **Stop** stops it.
   Not the one? The dice button makes a new take with another seed.
4. **Add** puts it on an audio track at the playhead. With **Bar and drop
   markers** on, markers show every bar and where the drops land, ready
   to cut to; **Stems too** also adds the drums, bass, harmony and lead
   as separate files in your media. One undo removes what Add placed.

Agents get more control through `generate_music` (sections with fixed
times, the loudness, the stems on their own tracks); see [[Automation]].

## Correct a song's beat grid

Select a music clip and open its **Audio** tab: **Beat grid** shows the
song's tempo, where its first bar starts (in the song's own seconds) and
its parts. A generated score already has one. For any other song choose
**Detect beat grid**: the app reads the song on your computer and draws
the grid on the clip, a dot on each beat and a line on each bar's first
beat. If the lines fall between the kicks, correct them:

- **Tempo**: type it, or play the song and click **Tap** along with the
  beat; the tempo shows on the button and is kept when you stop tapping.
- **First bar**: the arrows beside it nudge the grid 10 ms earlier or
  later; or park the playhead on a downbeat you hear and choose **Set
  downbeat here**.
- **Parts**: put the playhead where the drop (or the build, the outro)
  starts, pick it and choose **Add here**: it starts on the nearest bar.
  Rename or remove a part in its row; its time takes you there.

Each change is one undo step, and the song's beat and bar markers move
with the grid. **Clear grid** forgets it.

### Cut bars out of a song

Mark **In** and **Out** around the bars to take out, right-click the
song and choose **Cut bars**: the menu names how many (Cut 4 bars). Each
mark moves to the nearest bar line, the bars go, the rest of the song
closes up and plays on the beat, and the two pieces meet with a short
crossfade so nothing clicks. The marks are cleared; Undo brings the bars
back. The song needs its beat grid first, and plays at its own speed.

## Add sound effects and natural sound

The **Audio** tab also lists **Sound effects** (whooshes, hits, risers)
and **Ambience**: wind, a stream, a waterfall, surf, rain, a rocket's
rumble, city traffic and room tone, made on your computer and free to
use. Play a card to hear it first.

- A sound effect lands at the playhead on the **SFX** track (made the
  first time), never in a gap on your voiceover or your music; sounds
  that overlap get a second SFX track.
- An ambience bed lands on the **Ambience** track from the playhead (or
  where you drop it) to the end of the timeline, fading in and out. It
  moves like a recording (gusts come and go, waves break, cars pass) and
  can be trimmed like any audio clip; its level sits under a
  voice as it is.

Each audio track is a stem (dialog, music, effects or ambience), which
the loudness check and agents use; a track the app made knows which it
is, and an imported song counts as music.

## About OpenFrame

**Help → About OpenFrame** shows the version, the license (GPL-3.0-only:
you may share and change the app under its terms) and the open-source
packages it is built with. Its links open the license text, the source
code, this guide and the full list of third-party licenses in your
browser.

## Report a problem or help improve it

Follow [CONTRIBUTING.md](../CONTRIBUTING.md). Include the revision, OS,
desktop/browser target, steps, expected result, and actual result. Share only
media you have permission to share and remove private paths and tokens from
logs. Report it as an issue on the repository.

## Reuse settings

In the clip inspector's **Effects** tab, open **Effect presets…**. Name and
save the selected clip's stack, then choose it on another clip and **Apply
preset**. Presets append effects with independent animation and work across
projects on this device. Rename/delete them in the same dialog. Applying is
undoable; deleting a saved preset does not remove already applied effects.

Use **Copy attributes** in a clip inspector, select the destination clip(s),
then **Paste attributes…**. Choose transform (with crop, opacity, the drop
shadow and the border), color, audio (with the EQ and compressor) or effects. Checked
groups replace those settings and their animation; effects append unless
**Replace existing effects** is selected. Timing and source offsets stay put.
Unavailable groups need compatible targets on unlocked tracks. Undo restores
the previous settings.

## Preview trim edges

While dragging with Trim, Ripple, Slip, Roll or Slide, the player shows two
clip-edge frames and their times. Roll compares the outgoing and incoming
frames; Slide compares neighboring clips. Other tracks and transitions are
excluded so the cut is clear. Release to keep the edit; cancel the gesture to
restore it. The whole drag is one Undo step. In a short player the frames
shrink so the preview's title and note stay in view.

## Nest clips in a compound clip

Select the clips (any tracks: video, titles, sound), then choose **Create
compound clip** from the right-click menu or the **Timeline** menu (Alt+G).
They become one green clip that plays them as they were. Its speed,
position, scale, opacity, blend mode, color, effects and volume act on the
whole group, so a fade or a filter covers every layer at once.
Double-click it to edit what is inside; the bar above the timeline shows
where you are, and its first name takes you back. A change inside shows in
every copy of that compound clip. **Break apart** (Alt+Shift+G) puts the
clips back where they were. Undo works the same inside and out, and saving
or exporting always takes the whole project.

## Preview sources

Choose **Preview** under a media card to open its source. Play, scrub or step
frames, set **Mark In** and **Mark Out**, then **Add range**. Out includes the
frame you see. The range is placed using the current timeline mode; Undo
removes it. Previewing does not move the timeline playhead. Marks reset when
the preview closes. Image previews offer **Add image** instead.

**Insert** and **Overwrite** also honor the timeline marks. Mark source In
and Out plus timeline In to place that source range at the timeline In.
With timeline In and Out, mark only source In to read forward for that
length, or only source Out to backtime the source so it ends there. Outs
are exclusive in commands; the source monitor includes the displayed frame.
Four marks of different lengths ask for **Fit to fill** (change constant
speed) or **Trim source to fit** (speed one). The separate **Fit to fill**
button overwrites the timeline range using the selected source range; its
binding is shown in Keyboard shortcuts. Too little media leaves the timeline
and marks untouched. Successful Insert/Overwrite clears the timeline marks.
Agents use `edit_from_source` with optional source/timeline In/Out seconds.

To extend a timeline cut precisely, click a clip edge with Select. Its
bracket shows the chosen side. Add edges with Shift; Alt-click or
double-click a touching cut to choose both sides for a roll. Move the
playhead and use **Extend edit to playhead** from Timeline or Keyboard shortcuts.
With no edge selected, it finds the nearest edge on selected clips' tracks
(or all unlocked tracks). The frame nudge actions move selected edges; with
no selected edges they move clips. Escape clears brackets. **Select nearest
edit point**, **Select next edit point**, and **Select previous edit point**
move the edge selection without moving the playhead. A tie chooses the
earlier frame, then the outgoing side; gaps never roll. Limits appear in a
toast. These edits leave gaps even with the main-track magnet enabled.

## Organize media

In **Manage media → Organize folders**, create a folder, then choose it beside
each file. Mark **Favorite** for your preferred takes. Filter the library by
folder (**All folders**, beside the other filters) or **Favorites only** (the
heart beside the view buttons), combined with its other filters. Rename and
delete folders in the same section; deleting a folder unfiles its media and
keeps all clips and source files. Organization is saved with this project and
can be undone. These are virtual folders, so footage stays on disk where it is.

## Remove media

Right-click a media card and choose **Remove from project**. A file that
clips on the timeline use says how many and removes those clips too. To
clear out everything the timeline does not use, open **Manage media** and
choose **Remove unused**. Only the project forgets the file; it stays on
disk, and Undo brings it back.

## Relink moved media

Open **Media → Manage media** to check source availability and see file paths.
Choose **Locate…**, pick one replacement, review its path, then **Relink file**.
Every use keeps its cuts and effects; Undo restores the old location. Choose
the same media kind with the original audio/video streams and at least the
original duration. When a proxy exists, the check reports that editing copy.

## Titles that fit the frame

A new title's lines wrap inside the frame's safe area: on a vertical (9:16)
project, inside the column the TikTok, Reels and Shorts buttons leave, so a
long line breaks onto the next instead of running under them. To break a
line where you want, press Enter while editing the title on the canvas.
Titles made before this keep the width they had.

## Inline title styling

In the text inspector, expand **Style range**, choose a word, and set its color or weight. Clear word style restores that word to the title style. Agents can use `style_text_range` with character offsets or a literal match, including all occurrences, to apply color, gradient, weight, italic, underline, or size scale. Ranges use UTF-16 offsets with an exclusive end. Typing shifts and trims ranges; inserted characters inside a range inherit it. Run colors override animated base color. The inline editor preserves styling while typing; its caret and selection use the base font, so use the word picker for precise mixed-font range styling. Preview, alignment, text checks and version exports use the same run-aware raster layout.

## Layout presets

Select two to four overlapping pictures and open **Layouts** in the inspector. A picture on the main track stays there (in picture in picture it must be the full-frame one), so the timeline never ripples; the others stack above it on Layout tracks. Tiles offer side-by-side, stacked, grid, triptych (three pictures), and picture-in-picture arrangements. Choose **Fill** to crop each picture to its cell, or **Fit** to show the whole picture centered in it (a screen recording stays readable). The pictures move to Layout tracks just above the highest of their tracks, so a label you already placed above them stays on top. `apply_layout` also accepts gap and margin (fractions of the shorter canvas side), rounded mask radius, editable border shapes, and a slide or scale entrance. Clips are placed in input order, with the first PIP picture full frame. Layout replaces position, scale, rotation, crop, mask and their keys, plus clip animations, canvas fill, edge repetition and wiggle. Other effects remain. The whole layout is one undo step. Borders are separate shapes grouped with their pictures; remove an old border before applying another bordered layout.

## Group transforms

A multi-selection has one viewer box: drag it to move, use a corner to scale the arrangement, or the rotation handle to rotate it about its combined center. Each gesture is one undo step. `transform_group` accepts a `group_id` or explicit `clip_ids`, canvas-fraction x/y offsets, a scale multiplier and a rotation offset in degrees. Add `at` in timeline seconds to key every visual member using its own clip-relative time. Existing keys are preserved; audio members remain unchanged. Without `at`, geometry is evaluated at the latest member start and existing keyed paths receive keys there. Times outside a member clamp to that member’s span.

## Motion path points

Select a picture with position keyframes to see its motion path. Drag a dot to move that key position; the gesture is one undo step. A focused dot can also move one canvas pixel with an arrow key. The `move_motion_point` command takes a clip id, an existing key time in timeline seconds, and x/y positions in canvas fractions from center. Both axes receive a key at that time, with existing easing preserved.

## Shape a clip's sound

Select an audio clip or a video with sound and open **Audio**. Beside each
fade slider, choose its curve: **Linear** rises steadily, **Equal power**
uses a sine curve, **Logarithmic** rises quickly, **Exponential** rises
slowly, and **S curve** eases both ends. The timeline draws that shape.
The **Crossfade** row has the same choice; its default is Equal power.

**Pitch** moves the sound up or down by as much as an octave (12 semitones)
without changing its length. It works with speed changes and reverse.
Double-click the slider to reset to zero. This is separate from the Speed
tab's **Change pitch**, which lets pitch follow speed like tape. Pitch
cannot be keyframed.

In **Voice changer**, click Chipmunk, Deep, Robot, Radio, Telephone,
Megaphone, Cave or Monster to apply it and hear the clip's first three
seconds alone. Another chip replaces the audition. Fine-tune Pitch and
the ordinary EQ, compressor, filter, saturation, Robot frequency/mix,
echo and reverb controls. **None** clears those settings and their keys;
volume, pan, fades and tape stop stay. Undo restores the previous settings.
**Normalize loudness** measures the processed sound, including the voice
changer, so a filtered or distorted voice can be balanced with other lines.

## Crossfade audio clips

Where one audio clip ends and another starts on the same track, right-click
the first and choose **Crossfade into next clip**: the first fades out as
the second fades in, at constant power, over the seconds before the cut, so
the cut itself still lands where you put it. It takes the default
**Audio crossfades** length from **Preferences** (0.5 s), or as much as the clips
allow when that is less.
The timeline draws it as a small marker at the end of the first clip;
click it to open the clip's **Audio** tab, where **Crossfade** sets its
length (0 removes it). The second clip rises from the part of its file
before its start, so it needs some: when it starts at the very beginning
of its file, the menu says to trim its start first. Choose the menu item
again to remove the crossfade. Dragging any transition from the
**Transitions** tab onto the cut between two audio clips makes the same
crossfade.

## Mix tracks

Open **Mixer** from the timeline toolbar or **View > Mixer**. Move each
track's vertical fader to balance its level in dB, and use pan to place it
left or right. **Mute** silences a track; **Solo** plays only soloed tracks.
The meters show peak and RMS after track gain and pan. The master strip
controls the whole mix, including exports, and shows stereo levels and
short-term LUFS; with many tracks, their strips scroll sideways and the
master stays in view at the right. A drag is one undo step. Double-click a
fader or pan to reset it. Close the panel with **Close mixer** or Escape.

In an audio strip's **Effects** area, choose a processor and press **Add
insert**, or choose **Add preset**. **Dialog cleanup** starts with an 80 Hz
high-pass, a -50 dBFS gate, 4 dB de-essing, voice compression and a -1 dBFS
limiter. Click an insert's name to open its controls, then adjust sliders
or reset it. Its checkbox bypasses it; drag rows or use their up/down
buttons to change order; the trash button removes it. Track effects hear
all of the track's clips together and keep their state across cuts.

For one clip, select it and open **Audio > Dynamics**. Switch on **Gate**
to reduce noise between words, **De-esser** to soften sibilance, or
**Limiter** to hold peaks. Each shows its main control; **More** exposes
attack, hold, release or detector frequencies. **Parametric EQ** adds up
to eight bands with frequency (Hz), gain (dB), Q and filter shape. It runs
after the old Equalizer. Presets also work here and replace the clip's
insert chain; **Insert order and other effects** exposes the full chain.
A limiter's ceiling applies before later inserts and faders, which can
raise the level again. Its lookahead delays sound 5 ms per limiter.


The speaker in the player's transport and on the master strip is **Mute
playback**. It silences previews, scrubbing and auditions, and the master
meters read silence. It lasts for the app session and leaves exports
unchanged. Use **Mute track** and **Solo track** in the Timeline menu or
their entries in Keyboard shortcuts to toggle the tracks of selected
clips in one undo step. Those track settings do affect export.

## Use animated images

Import an animated GIF, WebP or APNG like any image. Supported webviews read
its frame timing and transparency. A new clip lasts one loop; drag its right
edge farther to repeat it. Hover across its library card to scrub frames.
The same animation is drawn during playback and export, including imported
animated stickers. Renaming it in the library keeps it moving: its format
comes from the file, not the name it shows. When ImageDecoder is
unavailable the image is treated as a still. Loops larger than 256 MiB after decoding are refused; use a smaller
animation in that case.

## Change the timeline display

Open **Timeline display** on the timeline toolbar to show or hide waveforms,
video thumbnails or clip names, and choose small, medium or large tracks.
These choices stay with your profile and do not change exports. Medium
retains individual heights set in track menus. On taller tracks (audio,
video and the main track) the name has a line of its own above the lock,
eye and sound buttons; point at a header to read a long name in full.
Right-click a track header and choose a **Track color** swatch to tint its
clips. A clip with its own label color keeps that color instead. **No
track color** removes the tint.

## Move or open a project file

On desktop, choose **File > Collect files**, then a destination folder.
OpenFrame creates a new subfolder containing `project.json` and `media`.
Wait for copying to finish, then move that entire subfolder together. Media,
proxies, LUTs and background-removal cutouts are included. A missing source
must be relinked before collecting. The original project and files stay put.

Choose **File > Open project file** and select the JSON. It opens as a new
saved project; its relative media paths are resolved beside the JSON on
desktop. If media is missing, open **Media > Manage media** and relink it.

On the web, **Collect files** downloads only the JSON. Media remains in this
browser profile. Opening that JSON elsewhere does not transfer its media;
relink the original files there. Automation's `collect_project` is desktop
only, and can name the destination folder itself (`folder`) instead of
asking; `open_project_file` accepts a path only on desktop.

An AI agent exporting over MCP writes into your Videos folder, in a folder
named OpenFrame, or into a folder it names. It never replaces a file: a
second export of the same name is saved as "Name (2)", and the agent is told.
Only when it names the folder and asks to replace (to supersede its own
earlier export there) does a new file take the old one's place, once the
export has finished.

## Move a timeline between editors

Choose **File > Import timeline…** and pick an `.otio`, `.fcpxml` or FCPXML
`.xml` file. It opens as a new saved project. The result lists the imported
tracks and media, plus anything that could not be mapped. Cuts, gaps,
overlays, audio tracks, dissolves, markers and compound sequences are
supported. Effects and speed changes need rebuilding after import.
On desktop, relative media paths are resolved beside the timeline file.
For missing sources, open **Media > Manage media** and relink the files.
The web build accepts the timeline file but can resolve only HTTP(S) media
URLs; local paths need relinking through its media picker.

Choose **File > Export timeline > OpenTimelineIO, FCPXML or EDL** to save
an editable timeline for another editor. FCPXML is version 1.10; EDL is
CMX 3600 and writes the main video track plus one file per audio track.
EDL omits overlays and markers and represents compounds as black.
OpenFrame titles and color clips become gaps in FCPXML in other editors;
OpenFrame can recover their basic text and color from its metadata.
The export result names each saved file and any format limitations.
Keep the original source files available: these exports do not collect
or render media. Other editors' interpretation still needs checking.

Agents use `import_timeline` with an absolute desktop `file` path (omit it
for the picker), and `export_timeline` with `format` (`otio`, `fcpxml`,
`edl`) and an optional absolute desktop `folder`. Each answer includes the
import or export report. On the web, export uses the save picker or download.

### Checking an agent-made film

Ask `preview_audio` to hear up to 30 seconds of the mix or one stem. MP3
is the default; if its encoder cannot run, the preview uses M4A or WAV and
names the actual `format`. You can request `format: "wav"` directly.
If a join fades into silence and there is no grid or Bar marker, its
measurements can suggest a `roll_edit` target within half a second where
both source files are silent. Apply that target to move the handoff while
keeping the two clips' outer edges.
`audio: false` returns measurements alone. Flat-range advice names pauses
held down by ducking; lower `duck_under_speech min_gap` or choose `open_at`
moments if you want music to rise there.

For portrait hooks, use size 70-110 and two to four words per line;
ordinary portrait titles use 50-90. Explicit lines in an end-card headline
shrink to fit the column before wrapping, down to the readable floor.
A 9:16 end card sizes its headline and button from the safe column, then
gives logo space first if the card needs to fit a shorter room.
Voiceover line start/end answers are the placed clip times; `seconds`
remains the speech length.

With `export_versions check: true`, use `check_times: [1, 11.5, 29]` for
seconds of the master, or `check_at: [0.15, 0.5, 0.92]` for fractions of
each version. Choose one. Cut-downs omit moments cut out of the master,
move end-card moments with the card, and show the opening if none remain.
Rings and spotlights inside compound scenes follow the footage in each
version. On tall versions, captions crossing a ring move above it when
there is safe room; the check sheet reports what moved in `done`.
A version override with `hidden: true` can hide a cinematic-bars adjustment.
On repeating texture without a distinct subject, automatic reframing stays
centered and says so; give `focus` to choose a region yourself. An adapted
title whose fade measures unevenly ends with a cut instead, named in
`options`; the master keeps its original animation.
