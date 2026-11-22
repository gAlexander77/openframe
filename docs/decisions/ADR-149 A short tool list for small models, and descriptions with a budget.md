# ADR-149: A short tool list for small models, and descriptions with a budget

**Date:** 2026-11-21. **Status:** accepted.

## Context

The owner asked what still stands between an agent, "both smart and dumb",
and a full video with complex edits made through the MCP tools. Two blind
tests ([[ADR-148 Punch-ins keep what they applied, angles switch by held opacity, a slideshow is ordinary clips]])
had judged the tools one by one. Neither had measured what a client pays
to connect, because the testers called tools by name through a small
script and never loaded the list.

Measured on 2026-11-21, `tools/list` answered:

- **207 tools, 363 KB, about 91,000 tokens**, before the model's first
  word. Descriptions were 120 KB of it and schemas 214 KB.
- 64 descriptions ran past 600 characters, 30 past 1,000 and 8 past 2,000
  (`export_versions`: 6,800). The second tester had called three of them
  "too long to use".
- A title's style (24 fields, 3.8 KB) was spelled out in eight tools.

That is close to half of a 200,000-token context, and more than the whole
context of many small models. Some clients cap the list: 128 tools in
OpenAI's API, 40 in Cursor for a long time. And a model chooses worse the
more tools it is shown: the in-app assistant was already cut to 15 tools
after a 9B model, given 30, "called freeze, marker and transition tools
instead of adding a title" (`src/state/assistant.ts`).

Clients that load tools on demand (Claude Code and Codex with a large
model) are not hurt by the count: they show names and fetch a schema when
the model asks. For them the full list is right.

## Decision

**Two lists, one server.** `tools/list` answers every tool unless the
transport says `core`:

- HTTP: `/mcp?tools=core`. The Rust server reads the query
  (`tools_for`) and passes it beside the body in the `mcp-request` event.
- stdio: `openframe --mcp-stdio --core-tools`; the bridge posts to that
  path.
- The web bridge (`scripts/mcp-web.mjs`) reads the same query.

`handleMcp(request, host, tools)` takes it as a third argument. Only
`tools/list` reads it: every tool is callable on either list, and nothing
else differs, so a client cannot land in a state where a tool exists for
one and not the other.

**The short list is 56 tools and `call_tool`** (`CORE_TOOLS` in
`src/lib/mcpGuide.ts`), in the order a video gets made: the tools the
guide's nine steps and the five playbooks name most, enough to cut,
caption, title, score, mix, check and export. `call_tool` takes a tool's
name and its arguments and runs it; `help` names every tool by step and
gives any tool's parameters, so the other 151 stay one `help` and one call
away. `direct` turns a `call_tool` request into a call of the tool it
names before anything else looks at it, so validation, jobs, the agent's
notice in the app and "did you mean" all work as they do for a direct
call. It also reads the two shapes a small model sends instead of the
right one: the arguments as a JSON string, and the arguments beside the
name.

About 20,000 tokens: under a quarter.

**Descriptions have a budget on both lists** (`brief`). A listed
description is its opening sentences within 900 characters (300 on the
short list), then "More: help topic NAME." `help` with the tool's name,
and [[MCP tools]], still give all of it. The first sentence is always
kept whole, and a tail under 150 characters is not worth a call and
stays. A test holds every listed description under twice its cap, which
two run-on openings failed (`check_project`: one sentence of 1,900
characters; `analyze_music`); each got a short opening sentence.

**A title's style is listed once** (`lean`): `add_text` spells out the 24
fields, and the seven other tools that take a style name it. Calls are
still validated against each tool's own full schema: only the listing is
shorter.

The full list is now 76,000 tokens (from 91,000) with nothing removed.

`call_tool` is second on the list, after `help`, and a client on the short
list is told of it when it connects (`initialize`'s instructions) and at
the top of `help`.

## A blind test with a small model (2026-11-21)

A Haiku-class model was given the short list, the same NASA footage as the
two earlier tests and no other knowledge, and asked for a 60 to 90 s
documentary short. It finished one: 66.7 s, seven lines of the talk under
seventeen cutaways, a J cut, a score ducked under the voice, captions, a
look, a lower third and an end card. **55 tool calls in 20 minutes, two
tool errors**, and it reached a tool outside its list (`add_track`)
through `call_tool` after one `help`. Its loudness passed and its project
check had no errors.

Its report was honest about what it noticed. A contact sheet of the film
showed what it had not, and what `check_project` had passed:

| Found | Cause | Done |
|---|---|---|
| The lower third's name and role sat outside their box | `add_text_template` lays a design out for its own words and draws its second lines under the readable size; `check_project` said to enlarge the one line, which then left its box and the title-safe area, and to move it, which left the box behind | The check's fix for a part of a group is `transform_group` (the design moves or grows as one). The guide and the playbook give names and end cards to `add_ad_element`, which fits its words; it is on the short list, and `add_text_template` says what it is for |
| The end card's headline wrapped into its subline | the same template, with a longer headline | `add_ad_element end_card` takes a `subline` and leaves the button out with `cta: ""` (it drew an empty pill) |
| Captions read "you" and "Thanks" where nobody spoke | the cutaways' reels played their own music, which the recognizer writes as sign-offs | `dropPhantoms`: a lone "you", "Thanks", "Thank you", "Bye" or "Music" with nothing said for 3 s either side is dropped where footage is heard (`hearAsset`; not a voiced line with a script, where "Thanks for watching!" may be the line), and so is a music mark. On the real reel a minute of music now answers no words |
| Two reels' music played under the interview | a cutaway is placed with its sound on | `add_media_clip` takes `volume`, and a video placed off the main track without one is told its sound plays |
| Three `caption_too_fast` warnings nothing could clear | the speaker said those lines at 20 to 21 characters a second with the next caption right behind | such a caption is a tip, and its fix says to leave it or reword it |
| `job_status` sent the first tool's arguments | the running job's note named the tool, not the call | the note is the call: `job_status with {"job_id":"…","wait":45}` |
| `duck_under_speech` refused inside `batch` | said at the end of a long description | `batch` says in its second sentence what it does not run |
| `check_project` has no kind for a documentary | | `documentary` is accepted and judged as `any` |

**A second run on the fixed build**, the same model and brief: 62 s, **56
tool calls in 13 minutes and no tool error**, a project check with nothing
found. Its lower third and end card were whole and clear of the captions,
its cutaways silent, its captions only what was said. It followed its
first long job with the right `job_status` call. What it still tripped
on, and what was done:

- `check_project` told it to `set_crossfade`, a tool not on its list (it
  got there through `call_tool`). The tools the checks name in their fixes
  are on the short list now: `set_crossfade`, `set_caption_look`,
  `transform_group`, `align_clips`. 56 tools.
- Told to move a lower third clear of the captions, it moved each part by
  hand: that fix is one `transform_group` call now.
- `duck_under_speech` answered `met: false` beside 13.0 measured for 13
  asked (one line was over its ceiling), as it had for the first run. The
  answer now says which target missed and what to do (`unmetNote`).
- `auto_captions` reported two captions too fast that `check_project` did
  not: 42 characters over 2.1 s is 20.000000000000004 a second when the
  length is two timeline seconds subtracted. `captionReading` has a hair
  of slack.

It could not name the speaker (nothing reads a name off the screen in the
browser build, and it sampled the talk too thinly to see one), and one
cutaway caught a reel mid-wipe.

Not fixed: a reel's own title card inside a cutaway (the shot list does
not see titles, and nothing reads burned-in text in the browser build),
the same shot used twice, a lower third that stays up after the picture
leaves the speaker, and shot lists that take five minutes a reel in a
headless browser without a GPU.

## Alternatives

- **Make the short list the default.** Better for an unconfigured small
  model, worse for the two clients the owner uses, which load tools on
  demand and would have to go through `call_tool` for three quarters of
  them. A default can change once a real client has been watched on each.
- **Choose by the client's name** (`initialize`'s `clientInfo`). A guess
  that goes stale with every client release, and the server holds no
  session to remember it in.
- **Let the model switch lists with a tool.** A client lists tools once;
  few act on `tools/list_changed`.
- **Rewrite all 64 long descriptions by hand.** The cut at a sentence end
  costs nothing per tool and holds for tools not written yet; hand edits
  went to the two openings the cut could not handle.
- **Group the tools into a few big ones** (`edit`, `sound`, `text` with an
  `action` parameter). Fewer names, the same tokens, and schemas a model
  fills in worse.

## Consequences

- A tool's first sentence is now what most models read. Write it to stand
  alone: what the tool does and when to reach for it.
- A new tool is on the full list only, until someone adds it to
  `CORE_TOOLS`. Keep that list near fifty.
- The app's **Connect agents** panel offers the full list only. A user
  who wants the short one adds `?tools=core` or `--core-tools` by hand
  ([[Automation]]).
- The in-app assistant keeps its own 15 tools.
- A template (`add_text_template`) still lays out for its own words. An
  agent is steered away from it for names and end cards rather than the
  templates being taught to fit; that is the upgrade if people use them
  with long words.
- A tester's report is not the film. Look at the result yourself: this
  one's two worst defects were in a contact sheet and in neither its
  report nor the project check.
