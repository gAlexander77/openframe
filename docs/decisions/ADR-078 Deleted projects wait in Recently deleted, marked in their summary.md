# ADR-078: Deleted projects wait in Recently deleted, marked in their summary

**Date:** 2026-10-18. **Status:** accepted.

## Context

Home deleted a project for good after a second click on its Delete
button ("Delete?"). A project is hours of work, and the audit ranked "no
way back from a deleted project" among the everyday gaps: Finder, Google
Drive and Premiere's Project panel let a delete be taken back, and phone
editors keep a "Recently deleted" album. The desktop app keeps projects
as JSON files in its data folder (ADR-011); the web build keeps them in
the browser's private storage (OPFS). Both go through the platform seam
(ADR-003) with `listProjects`, `loadProject`, `saveProject(project,
summary)` and `deleteProject`, and both store the summary Home lists as
opaque JSON beside the project (Rust lists it as `serde_json::Value`).

## Decision

- **Delete marks the summary** with `deletedAt` (milliseconds) and keeps
  the project file where it is. Home lists projects without the mark;
  marked ones show in a closed **Recently deleted** section under the
  grid, newest first, each with when it goes for good, **Restore** and
  **Delete forever**.
- **No new platform calls.** Marking and restoring load the project's
  JSON and save it back unchanged with the new summary, so the desktop
  app and the web build behave the same with the code they already had,
  and no Rust or OPFS layout changes (`lib/projectTrash.ts`,
  `trashProject` and `restoreProject` in `state/project.ts`).
- **One click deletes, with Undo on the toast** (eight seconds). The old
  second click guarded an action that could not be undone; now it can.
  **Delete forever** is the one that cannot, so it asks twice.
- **Thirty days**, then Home deletes the project for good the next time it
  lists projects (`listSaved`). Nothing runs in the background.
- **Agents do not see the trash**: `list_projects` and `open_project`
  read the same filtered list, so a model never reopens a project the
  user threw away. Restoring is the user's call, on Home.
- Media files are never touched, as before.

## Consequences

- Restoring keeps `updatedAt`, so the project returns to its place in the
  list.
- Re-saving the project file on delete and restore copies it to its
  `.bak` on the desktop (ADR-011's previous-save copy); harmless, and the
  only extra write.
- A project deleted on one machine and synced elsewhere by hand carries
  its mark; that Home shows it in Recently deleted, as it should.
- The empty-draft discard (ADR-073) still deletes for good: an untouched
  new project was never the user's work.
- Drives: `project-trash` (Undo, Restore, Delete forever, agents), and
  `project-races` checks a keyboard Delete moves the project to Recently
  deleted without opening it.
