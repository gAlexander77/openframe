// What Home lists for a project, from the project alone (no thumbnail: that
// needs the rendered picture, so the editor adds it when it saves).
import { framesToSeconds } from "../time";
import { projectDuration } from "./ops";
import type { Project } from "./types";

export function projectSummary(p: Project) {
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    width: p.width,
    height: p.height,
    duration: framesToSeconds(projectDuration(p), p.fps),
  };
}
