// Site-wide facts and the base-aware link helper. The site is served from
// https://galexander77.github.io/openframe/, so every internal link and
// asset path goes through `href` (astro.config.mjs sets base and site).

export const SITE = {
  name: "OpenFrame",
  tagline: "The open video editor AI can drive.",
  description:
    "OpenFrame is a free, open-source, desktop-first video editor: CapCut's ease with the depth of Premiere and VEGAS. It runs on your computer, and any AI agent can edit with you through its MCP tools.",
  repo: "https://github.com/gAlexander77/openframe",
  repoName: "gAlexander77/openframe",
  license: "GPL-3.0-only",
  licenseUrl: "https://github.com/gAlexander77/openframe/blob/main/LICENSE",
  origin: "https://galexander77.github.io",
} as const;

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

/** A path inside the site, with the deploy base in front: href("docs/") is
 * "/openframe/docs/". Pages end in a slash (trailingSlash: "always"). */
export function href(path = ""): string {
  return BASE + path.replace(/^\/+/, "");
}

/** A file in the repository on GitHub, for links to sources and docs. */
export function repoFile(path: string): string {
  return `${SITE.repo}/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export const NAV = [
  { path: "features/", label: "Features" },
  { path: "ai/", label: "AI and MCP" },
  { path: "experiment/", label: "How it was built" },
  { path: "docs/", label: "Docs" },
] as const;
