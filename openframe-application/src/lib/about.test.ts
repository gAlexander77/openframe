import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ABOUT_LINKS, cargoDependencies, lockedVersions, readCredits } from "./about";

const TOML = `
[package]
name = "openframe"
version = "0.1.0"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde_json = "1" # a comment
# not = "this"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61" }

[dev-dependencies]
tempfile = "3"
`;

const LOCK = `
version = 4

[[package]]
name = "serde_json"
version = "1.0.140"

[[package]]
name = "tauri"
version = "2.9.1"

[[package]]
name = "windows-sys"
version = "0.59.0"

[[package]]
name = "windows-sys"
version = "0.61.2"
`;

it("reads the crates the app names, not build or dev ones", () => {
  expect(cargoDependencies(TOML)).toEqual(["tauri", "serde_json", "windows-sys"]);
});

it("takes the highest locked version of a crate locked twice", () => {
  const v = lockedVersions(LOCK);
  expect(v.get("windows-sys")).toBe("0.61.2");
  expect(v.get("tauri")).toBe("2.9.1");
});

it("credits npm packages as installed, then crates as locked", () => {
  const installed = (name: string) => (name === "react" ? { version: "19.3.0", license: "MIT" } : null);
  const credits = readCredits({ dependencies: { react: "^19.3.0", mediabunny: "^1.61.4" } }, installed, TOML, LOCK);
  expect(credits).toEqual([
    { name: "mediabunny", version: "1.61.4", kind: "npm" },
    { name: "react", version: "19.3.0", license: "MIT", kind: "npm" },
    { name: "serde_json", version: "1.0.140", kind: "crate" },
    { name: "tauri", version: "2.9.1", kind: "crate" },
    { name: "windows-sys", version: "0.61.2", kind: "crate" },
  ]);
});

it("reads this repository's own manifests", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const credits = readCredits(pkg, () => null, readFileSync("src-tauri/Cargo.toml", "utf8"), readFileSync("src-tauri/Cargo.lock", "utf8"));
  expect(credits.map((c) => c.name)).toEqual(expect.arrayContaining(["mediabunny", "react", "tauri", "serde"]));
  expect(credits.filter((c) => c.kind === "crate").every((c) => /^\d+\.\d+/.test(c.version))).toBe(true);
});

it("opens the same pages on the desktop as on the web", () => {
  // The desktop app opens About's pages by name (src-tauri/src/about.rs);
  // its addresses must be these.
  const rust = readFileSync("src-tauri/src/about.rs", "utf8");
  const repo = /const REPOSITORY: &str = "([^"]+)"/.exec(rust)![1];
  const expanded = rust.replaceAll("{REPOSITORY}", repo);
  for (const url of Object.values(ABOUT_LINKS)) expect(url === repo || expanded.includes(`"${url}"`)).toBe(true);
  for (const page of Object.keys(ABOUT_LINKS)) expect(rust).toContain(`"${page}" =>`);
});
