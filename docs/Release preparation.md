# Open-source release preparation

**Status:** GPL-3.0-only adopted in LICENSE and README on 2026-10-14.
The rename landed and the owner made the repository public on 2026-10-17;
packaged releases (installers, signing) are what this document still
prepares.

## Licensing decision

Copyright (C) 2026 The OpenFrame contributors.

Original project code and documentation are offered under the GNU General
Public License, version 3 only (`GPL-3.0-only`). The owner selected GPL-3.0
so distributed derivatives preserve the same freedoms. The exact terms,
including redistribution, corresponding source, and warranty provisions,
are in the root LICENSE. Running the editor does not automatically license
a user's original video under the GPL; third-party material retains its
own terms.

The complete license text was obtained from the
[SPDX GPL-3.0-only record](https://spdx.org/licenses/GPL-3.0-only.html)
and its license-list-data text. The project grant in README selects
version 3 only; the generic license appendix contains example notices and
is retained verbatim. Do not silently switch to `GPL-3.0-or-later`.

## Next implementation tasks

- [x] Set license metadata to `GPL-3.0-only` in `package.json` and
  `src-tauri/Cargo.toml`, updating generated metadata where appropriate.
  `package.json`'s `private: true` prevents npm publication; it does not
  control GitHub visibility and need not be removed to open the source.
  Completed 2026-10-14 in both manifests and the npm lockfile's root entry;
  dependency versions and repository visibility are unchanged.
- [ ] Add the relevant copyright/license notice to original source files
  and include the complete license and notices with distributions.
- [ ] Provide an About/license surface in the app and verify how users can
  obtain the corresponding source for the exact distributed revision.
- [ ] Review direct and transitive dependency terms, bundled binaries,
  worker/WASM payloads, model files, icons, fonts, stickers, and test media.
  Preserve notices and meet the obligations of the versions actually shipped.
- [ ] Verify any FFmpeg package's build configuration, license, source
  access, and bundled notices. ADR-013 currently specifies an LGPL FFmpeg
  build; adopting GPL for OpenFrame does not itself change that decision.
- [ ] Validate source checkout/build instructions, platform prerequisites,
  and release contents from a clean worktree. Verify the desktop release
  workflow and document browser support separately.
- [ ] Prepare a private security-reporting contact and actual contribution
  channels before announcing a public community.
- [ ] Review repository contents/history and distribution artifacts for
  private media, credentials, MCP tokens, and local-machine information.
  Do not rewrite shared history or delete other agents' work during this pass.
- [ ] Complete the coordinated rename and its compatibility checks in
  [[Renaming]]. Follow the owner's naming decision; existing unrelated uses
  discussed during naming do not imply affiliation or name clearance.
- [ ] Obtain the owner's separate publication instruction before changing
  repository visibility, remote name, hosting, or publishing releases.

## Initial dependency inventory

The expanded [[Third-party licenses]] inventory records 52 installed
production npm packages and 420 Cargo dependency packages at `94ea867`,
including transitive dependencies and declarations flagged for owner review.
It does not complete the release audit or the checkbox above.

These are declarations read from the installed direct frontend package
manifests on 2026-10-14. This is a starting inventory, not a completed
distribution audit; reproduce it against the actual release lockfile and
inspect bundled/transitive components and their full license texts.

| Package | Inspected version | Declared license |
|---|---|---|
| `@tauri-apps/api` | 2.12.3 | Apache-2.0 OR MIT |
| `@tauri-apps/plugin-dialog` | 2.8.2 | MIT OR Apache-2.0 |
| `react` | 19.3.0 | MIT |
| `react-dom` | 19.3.0 | MIT |
| `mediabunny` | 1.61.4 | MPL-2.0 |
| `@mediabunny/aac-encoder` | 1.61.4 | MPL-2.0 |
| `@huggingface/transformers` | 4.3.1 | Apache-2.0 |
| `lucide-react` | 1.56.0 | ISC |

Rust dependencies declared in Cargo.toml include Tauri, tauri-build, serde,
serde_json, tauri-plugin-dialog, and Windows-only windows-sys. Their exact
locked versions, transitive dependencies, and notices still need inventory.

The AAC extension describes a libavcodec-based encoder; its package-level
MPL declaration is not a substitute for inspecting the embedded codec/WASM
notices. Whisper model weights, downloaded tools, optional local model
servers, and their models also need separate attribution and license checks.
Remove BG's two models are recorded in [[Third-party licenses]] (both
Apache-2.0, downloaded on first use, not bundled). For owner review: ormbg's
card lists training sets with their own release terms (P3M-10K, AIM-500,
PPM-100); see [[ADR-032 Remove BG runs ormbg on WebGPU, MediaPipe on WASM]].
Research notes describe many possible providers and models; listing one in
research does not mean it is a shipped dependency.

## What this pass completed

The license text, project license grant, AI-development disclosure, user and
contribution guides, and the next-agent rename/release plan were added.
Manifest metadata, source headers, About UI, artifact notices, app identity,
GitHub settings, and public release operations were intentionally left for
the next authorized implementation work.
