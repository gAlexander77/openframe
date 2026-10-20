// Activate / deactivate clip (CapCut's, Premiere's Enable) as one switch for
// the whole selection (ADR-109): while any selected clip plays, it turns
// them all off; when every one is off, it turns them all back on. The
// clip menu, the V key, the undo step and an agent's set_clip_enabled
// notice all name it by the same rule.

import type { Clip } from "./project/types";

/** "Deactivate clip", "Activate 3 clips". */
export const enableLabel = (enabled: boolean, count: number) => `${enabled ? "Activate" : "Deactivate"} ${count === 1 ? "clip" : `${count} clips`}`;

/** What the switch does to these clips, and its name. */
export function enableToggle(clips: Pick<Clip, "disabled">[]): { enabled: boolean; label: string } {
  const enabled = clips.length > 0 && clips.every((c) => c.disabled);
  return { enabled, label: enableLabel(enabled, Math.max(1, clips.length)) };
}
