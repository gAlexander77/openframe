// The in-page automation surface: `window.videoEditor`. The same command
// registry agents use (ADR-006), plus actions, state and frame access, so
// drive scripts, the future MCP bridge and the headless renderer all speak
// to the app one way. Every edit made here is undoable like a user's.

import { player } from "./engine/player";
import { COMMANDS, describeProject, runCommand } from "./lib/commands";
import type { ActionId } from "./lib/keymap";
import { run } from "./state/actions";
import { importLuts } from "./state/luts";
import { importFiles } from "./state/media";
import { store } from "./state/store";
import { platform } from "./platform";

export const automation = {
  /** Every command with its JSON Schema, for tool listing. */
  commands: () => COMMANDS.map(({ name, description, input }) => ({ name, description, input })),
  /** Run one command as an undoable edit. Throws with every problem named. */
  exec(name: string, args: unknown = {}) {
    store.edit(name.replace(/_/g, " "), (p) => runCommand(p, name, args));
    return describeProject(store.get().project);
  },
  describe: () => describeProject(store.get().project),
  project: () => store.get().project,
  state: () => {
    const { project: _p, ...rest } = store.get();
    return rest;
  },
  action: (id: ActionId) => run(id),
  seek: (frame: number) => store.seek(frame),
  select: (ids: string[]) => store.select(ids),
  /** Import files by URL (web) or path (desktop). */
  async import(srcs: { name: string; src: string; size?: number }[]) {
    return importFiles(srcs.map((s) => ({ name: s.name, src: s.src, size: s.size ?? 0 })));
  },
  /** Import .cube LUTs by URL (web) or path (desktop) into project.luts;
   * apply_lut then puts one on a clip. Returns the new entries. */
  importLuts: (srcs: { name: string; src: string }[]) => importLuts(srcs),
  /** Resolves once the viewer has drawn the current frame. */
  rendered: () => player.idle(),
  /** The viewer's pixels as RGBA, top row first (for frame-accuracy checks). */
  pixels: () => player.pixels(),
  platform: () => platform.kind,
};

declare global {
  interface Window {
    videoEditor: typeof automation;
  }
}

window.videoEditor = automation;
