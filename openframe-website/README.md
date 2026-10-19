# OpenFrame website

The product site for OpenFrame, at <https://galexander77.github.io/openframe/>.
A static [Astro](https://astro.build/) site with two React islands, plain
CSS with design tokens, self-hosted Inter, and no analytics or third-party
requests. It is self-contained: its own `package.json`, lockfile,
`node_modules` and scripts. It never imports the app's source; the only
thing it reads outside this folder is the repository's `docs/`, at build
time. Why and how: [docs/Website.md](../docs/Website.md).

## Develop

Needs Node.js 22.12 or later.

```sh
cd openframe-website
npm ci
npm run dev        # http://127.0.0.1:1447/openframe/
```

`npm run dev` serves on port 1447 (the app's own dev servers use 1420 and
up). The site lives under `/openframe/`, as on GitHub Pages.

Astro collects anonymous CLI usage data unless told not to. Turn it off
once with `npx astro telemetry disable`, or set `ASTRO_TELEMETRY_DISABLED=1`
(the deploy workflow does).

## Build

```sh
npm run build      # astro check, then astro build into dist/
npm run preview    # serve dist/ on port 1447
```

The build reads `../docs` (set `OPENFRAME_DOCS` to read another folder):
the docs pages, the MCP tool reference and the numbers the site quotes
(tool count, decision count, effect and transition counts) all come from
there, so they change when the docs change. Both commands must finish with
no errors and no warnings.

## Where things are

| Path | What |
|---|---|
| `src/pages/` | One file per page; `docs/[slug].astro` renders docs from `../docs` |
| `src/lib/docs.ts` | Reads and renders `../docs`: markdown, wiki links, the MCP reference, quoted facts |
| `src/lib/features.ts` | The feature groups: one icon and one hue each, used everywhere |
| `src/data/` | The film's chapters and music sections; the build-from-source commands |
| `src/components/` | `FilmPlayer.tsx` and `ToolFinder.tsx` (the islands), `Loop`, `Shot`, `Command`, `Icon` |
| `src/icons/` | The app's own icon set as SVG files (Lucide, ISC; see `LICENSE` there) |
| `src/assets/screens/` | Screenshots from `scripts/capture.mjs` (Astro makes AVIF and WebP sizes) |
| `src/assets/media/` | Poster frames for the film and the loops |
| `public/media/` | The launch film (H.264) and the feature loops (VP9 WebM and H.264 MP4) |
| `scripts/` | `capture.mjs`, `make-media.mjs`, `make-images.mjs`, `copy-icons.mjs` |

## Screenshots

`scripts/capture.mjs` drives a running web build of the app in a headless
browser and writes `src/assets/screens/*.webp`. It never opens a window.

```sh
# in the app's checkout: npm run dev (or any port), then here:
node scripts/capture.mjs --url http://localhost:1441 --media "<demo media folder>"
```

- `--url` is the app's dev server; it is only read, never stopped.
- `--media` is a folder holding the demo clips, named as the script's
  header lists (`launch.mp4`, `orbit.mp4`, ... `liftoff.m4a`): the CC0 and
  public-domain footage on the site's Credits page. The script serves them
  on a random local port and imports them through `window.videoEditor.mcp`,
  as an agent would.
- `--only home,editor` retakes some shots; `--channel chrome` uses Chrome
  instead of Edge.

Each run starts a fresh browser profile in `.cache/` (git-ignored), builds
the same demo projects, stubs the local model list (no installed model's
name can appear), refuses every request that is not the app or the media
server, and fixes the clock, so the shots come out the same. Look at every
image before committing it (the checklist is in docs/Website.md).

## Media

```sh
node scripts/make-media.mjs --film "<OpenFrame launch film.mp4>" --footage "<footage folder>"
node scripts/make-images.mjs      # icons from public/favicon.svg, and public/og.png
node scripts/copy-icons.mjs <app icons index.ts> <lucide-react/dist/esm> src/icons
```

`make-media.mjs` makes the web film (H.264 1080p, about 13 MB, faststart),
the loops (1280x720, 5 to 8 seconds, cropped to the feature) and their
posters, with all metadata stripped. Crops and in and out points are in
its `LOOPS` table.

## Deploy

`.github/workflows/pages.yml` builds this folder and deploys `dist/` to
GitHub Pages with `actions/deploy-pages`, on pushes to `main` that change
`openframe-website/`, `docs/` or the workflow, or by hand. It does nothing
until the owner pushes and sets the repository's Settings > Pages > Source
to "GitHub Actions".
