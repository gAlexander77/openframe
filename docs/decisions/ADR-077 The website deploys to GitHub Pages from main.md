# ADR-077: The website deploys to GitHub Pages from main

**Date:** 2026-10-18. **Status:** accepted; inactive until the owner
enables Pages.

## Context

The site needs a host. The owner's rules: nothing of ours runs on a server
(ADR-003), GitHub Pages is the only thing that may deploy automatically,
it deploys only when the site or the docs it reads change, and nothing
else in the repository builds or publishes releases.

## Decision

- **GitHub Pages at the repository's default URL,**
  `https://galexander77.github.io/openframe/`: `site` and `base` in
  `astro.config.mjs`, every internal link through `href()` in
  `src/lib/site.ts`, and `trailingSlash: "always"` with directory output so
  Pages serves `/openframe/features/` without redirects.
- **`.github/workflows/pages.yml`** builds `openframe-website/` (`npm ci`,
  `npm run build`, which runs `astro check` first) and deploys `dist/` with
  `actions/upload-pages-artifact` and `actions/deploy-pages`. It runs on
  pushes to `main` that touch `openframe-website/**`, `docs/**` or the
  workflow itself, and by hand (`workflow_dispatch`). One deployment runs
  at a time and a newer push waits rather than cancels.
- **It does nothing until the owner pushes and sets Settings > Pages >
  Source to "GitHub Actions".** No secret is needed: the workflow uses the
  `pages: write` and `id-token: write` permissions Pages provides.
- **Astro's CLI telemetry is off** in the workflow
  (`ASTRO_TELEMETRY_DISABLED=1`), in keeping with the project.

## Consequences

- A docs-only change redeploys the site, so the MCP reference and the user
  guide online follow `main`.
- On a project site, `robots.txt` lives at `/openframe/robots.txt`, which
  crawlers do not read (they read the host's root). The sitemap is still
  linked from every page's head; submit
  `https://galexander77.github.io/openframe/sitemap-index.xml` in a search
  console to have it read. A custom domain would put `robots.txt` at the
  root.
- Moving to another host (a custom domain on Pages, or elsewhere) means
  changing `site` and `base` in one file; links follow.
