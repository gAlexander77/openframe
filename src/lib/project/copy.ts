import { uid } from "./defaults";
import type { Project } from "./types";

/** Independent edit document, shared source file references. */
export function copyProject(project: Project, name: string, id = uid("p")): Project {
  const clean = name.trim();
  if (!clean || clean.length > 120) throw new Error("Use a project name between 1 and 120 characters.");
  if (id === project.id) throw new Error("A copy needs its own project identity.");
  return { ...structuredClone(project), id, name: clean, createdAt: Date.now(), updatedAt: Date.now() };
}
