import type { Project } from "./project/types";
/** Visit only persisted media locations, including proxies, LUTs and nested cutouts. */
export function rewriteProjectPaths(project: Project, rewrite: (src: string) => string): Project {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, (k === "src" || k === "proxy") && typeof v === "string" ? rewrite(v) : visit(v)]));
  };
  return visit(project) as Project;
}
export function resolveProjectPath(src: string, file: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(src)) return src;
  const base = file.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
  const parts: string[] = [];
  for (const part of `${base}/${src.replace(/\\/g, "/")}`.split("/")) {
    if (part === ".") continue;
    if (part === ".." && parts.length > 1) parts.pop(); else parts.push(part);
  }
  return parts.join("/");
}
