// Which inspector sections the viewer opened or closed, by section name,
// so a reload or another clip finds them as they were left (CapCut keeps
// its panels' state). Per viewer, like the layout, never in a project.

export type SectionMemory = Record<string, boolean>;

/** Sections remembered at most; the oldest choice goes first. */
export const SECTION_MEMORY_LIMIT = 200;

/** A saved memory, keeping only true/false entries. */
export function readSectionMemory(raw: unknown): SectionMemory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => k && typeof v === "boolean")) as SectionMemory;
}

/** The memory with `id` set to `open`, as the newest choice. */
export function rememberSection(m: SectionMemory, id: string, open: boolean): SectionMemory {
  const { [id]: _, ...rest } = m;
  const entries = [...Object.entries(rest), [id, open] as const];
  return Object.fromEntries(entries.slice(-SECTION_MEMORY_LIMIT));
}
