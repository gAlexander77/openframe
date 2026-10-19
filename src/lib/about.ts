// Help > About: where the app comes from, its license and what it is built
// with. The credits are read from the manifests at build time (vite.config.ts
// calls readCredits), so the list cannot drift from what ships. Pure: the
// config and the tests both import it.

export const REPOSITORY_URL = "https://github.com/gAlexander77/openframe";

/** The pages About links to. The desktop app opens only these, by name
 * (src-tauri/src/about.rs), the way it opens an agent CLI's install page:
 * the webview never hands the shell a URL of its own. */
export const ABOUT_LINKS = {
  repository: REPOSITORY_URL,
  guide: `${REPOSITORY_URL}/blob/main/docs/User%20guide.md`,
  license: "https://www.gnu.org/licenses/gpl-3.0.html",
  credits: `${REPOSITORY_URL}/blob/main/docs/Third-party%20licenses.md`,
} as const;
export type AboutLink = keyof typeof ABOUT_LINKS;

export interface Credit {
  name: string;
  version: string;
  /** The package's declared license; crates leave it to the inventory. */
  license?: string;
  kind: "npm" | "crate";
}

/** Names of the crates in a Cargo.toml's [dependencies] tables (the
 * target-specific ones too), not build or dev dependencies. */
export function cargoDependencies(toml: string): string[] {
  const names: string[] = [];
  let inDeps = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (line.startsWith("[")) {
      inDeps = /^\[(target\..*\.)?dependencies\]$/.test(line);
      continue;
    }
    const m = inDeps && /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** Each package's version in a Cargo.lock; the highest when several are
 * locked. */
export function lockedVersions(lock: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of lock.split(/\[\[package\]\]/).slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    const had = out.get(name);
    if (!had || compareVersions(version, had) > 0) out.set(name, version);
  }
  return out;
}

const compareVersions = (a: string, b: string) => {
  const pa = a.split(/[.+-]/).map(Number), pb = b.split(/[.+-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};

/** The credits: every runtime npm dependency as installed, then every crate
 * the app names, sorted by name within each. `installed` reads an npm
 * package's own package.json (null when it is missing). */
export function readCredits(
  pkg: { dependencies?: Record<string, string> },
  installed: (name: string) => { version?: string; license?: string } | null,
  cargoToml: string,
  cargoLock: string,
): Credit[] {
  const npm = Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name): Credit => {
      const m = installed(name);
      return { name, version: m?.version ?? pkg.dependencies![name].replace(/^[\^~]/, ""), ...(m?.license ? { license: m.license } : {}), kind: "npm" };
    });
  const locked = lockedVersions(cargoLock);
  const crates = cargoDependencies(cargoToml)
    .sort()
    .map((name): Credit => ({ name, version: locked.get(name) ?? "", kind: "crate" }));
  return [...npm, ...crates];
}
