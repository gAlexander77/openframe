// The inspector sections' open or closed state, kept in this browser
// (lib/sectionMemory.ts): per viewer, like the layout and the keymap.

import { readSectionMemory, rememberSection, type SectionMemory } from "../lib/sectionMemory";

const KEY = "ve.sections";

let memory: SectionMemory = (() => {
  try {
    return readSectionMemory(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return {};
  }
})();

/** Whether the viewer left section `id` open, if they ever chose. */
export const sectionOpen = (id: string): boolean | undefined => memory[id];

export function setSectionOpen(id: string, open: boolean) {
  memory = rememberSection(memory, id, open);
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}
