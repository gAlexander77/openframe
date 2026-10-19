import { ExternalLink } from "../icons";
import { type AboutLink } from "../lib/about";
import { APP_NAME } from "../lib/brand";
import { platform } from "../platform";
import { toast } from "../state/toast";
import { Dialog } from "./Dialog";

const open = (page: AboutLink) => void platform.openLink(page).catch((e) => toast(`Couldn't open the page: ${e instanceof Error ? e.message : e}`, "error"));

function LinkButton({ page, children }: { page: AboutLink; children: React.ReactNode }) {
  return (
    <button type="button" className="link-btn" onClick={() => open(page)}>
      {children} <ExternalLink size={11} />
    </button>
  );
}

/** Help > About: name, version, the license, where the source and the
 * guide live, and the open-source software the app is built with (read
 * from the manifests when it was built, src/lib/about.ts). */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const npm = __APP_CREDITS__.filter((c) => c.kind === "npm");
  const crates = __APP_CREDITS__.filter((c) => c.kind === "crate");
  return (
    <Dialog title={`About ${APP_NAME}`} onClose={onClose} className="about-dialog">
      <div className="about-head">
        <div className="app-mark about-mark" aria-hidden />
        <div>
          <strong className="about-name">{APP_NAME}</strong>
          <span className="about-version num">
            Version {__APP_VERSION__} · {platform.kind === "desktop" ? "Desktop app" : "Web app"}
          </span>
        </div>
      </div>
      <p className="about-text">A video editor that runs on your own computer: your media and projects stay there, and its AI tools run there too.</p>
      <section className="about-section" aria-label="License">
        <h3>License</h3>
        <p className="about-text">
          Free software under the GNU General Public License, version 3 only (GPL-3.0-only). You may share and change it under its terms; it comes with no
          warranty. <LinkButton page="license">Read the license</LinkButton>
        </p>
      </section>
      <nav className="about-links" aria-label="Links">
        <LinkButton page="repository">Source code</LinkButton>
        <LinkButton page="guide">User guide</LinkButton>
        <LinkButton page="credits">Third-party licenses</LinkButton>
      </nav>
      <section className="about-section" aria-label="Credits">
        <h3>Built with open-source software</h3>
        <table className="about-credits">
          <tbody>
            {npm.map((c) => (
              <tr key={`npm ${c.name}`}>
                <td>{c.name}</td>
                <td className="num">{c.version}</td>
                <td>{c.license}</td>
              </tr>
            ))}
            {crates.map((c) => (
              <tr key={`crate ${c.name}`}>
                <td>{c.name}</td>
                <td className="num">{c.version}</td>
                <td>Rust crate</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="about-note">These are the packages {APP_NAME} uses directly. Third-party licenses lists every package they bring with them, with its license.</p>
        <p className="about-note">
          MP3 files are encoded by the <LinkButton page="lame">LAME MP3 Encoder</LinkButton> (LGPL).
        </p>
      </section>
      <footer>
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </Dialog>
  );
}
