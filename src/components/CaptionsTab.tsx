import { useRef, useState } from "react";
import { ASR_MODELS, type TranscribeProgress } from "../engine/transcribe";
import { Captions, Download, Search, Upload, WandSparkles } from "../icons";
import { replaceText } from "../lib/captions";
import { CAPTION_LOOKS, lookStyle } from "../lib/captionLooks";
import type { TextStyle } from "../lib/project/types";
import { runCommand } from "../lib/commands";
import { cancelCaptions, captionClips, exportCaptions, generateCaptions, importCaptions } from "../state/captions";
import { store, useEditor } from "../state/store";
import { toast } from "../state/toast";
import { Toggle } from "./inspector/controls";
import { TranscriptCard } from "./TranscriptCard";

const LANGUAGES: [string, string][] = [
  ["", "Detect automatically"],
  ["english", "English"],
  ["spanish", "Spanish"],
  ["french", "French"],
  ["german", "German"],
  ["italian", "Italian"],
  ["portuguese", "Portuguese"],
  ["dutch", "Dutch"],
  ["japanese", "Japanese"],
  ["korean", "Korean"],
  ["chinese", "Chinese"],
  ["hindi", "Hindi"],
  ["arabic", "Arabic"],
  ["russian", "Russian"],
];

const STAGE: Record<TranscribeProgress["stage"], string> = {
  mixing: "Preparing audio",
  downloading: "Downloading model",
  transcribing: "Recognizing speech",
};

/** A look's caption as CSS, near enough to choose by: outline, glow, box
 * and case as the renderer draws them, at a card's size. */
function lookCss(s: TextStyle): React.CSSProperties {
  return {
    fontFamily: s.font,
    color: s.color,
    fontWeight: s.bold ? 700 : 400,
    textTransform: s.case === "upper" ? "uppercase" : s.case === "lower" ? "lowercase" : s.case === "title" ? "capitalize" : undefined,
    WebkitTextStroke: s.stroke?.width ? `${Math.min(2, s.stroke.width / 4)}px ${s.stroke.color}` : undefined,
    paintOrder: "stroke fill",
    textShadow: s.shadow ? `${s.shadow.x / 4}px ${s.shadow.y / 4}px ${s.shadow.blur / 3}px ${s.shadow.color}` : undefined,
    background: s.background?.color,
    padding: s.background ? "1px 6px" : undefined,
    borderRadius: s.background ? 4 : undefined,
  };
}

/** CapCut's caption templates: every caption takes a look in one click. */
function CaptionLooks() {
  return (
    <div className="cap-card">
      <header className="cap-head">
        <strong>Looks</strong>
      </header>
      <div className="cap-looks">
        {Object.entries(CAPTION_LOOKS).map(([id, look]) => {
          const s = lookStyle(id);
          return (
            <button key={id} className="cap-look" aria-label={`${look.label} captions`} data-tip={`Give every caption the ${look.label} look`} onClick={() => store.edit(`Caption look ${look.label}`, (p) => runCommand(p, "set_caption_look", { look: id }))}>
              <span className="cap-look-sample" aria-hidden="true" style={lookCss(s)}>
                Say {s.highlight ? <span style={{ color: s.highlight }}>this</span> : "this"}
              </span>
              <span className="cap-look-name">{look.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** CapCut's Captions tab, local: spoken language, model, clear-existing,
 * a full-width Generate button with progress; import and export SRT/VTT. */
export function CaptionsTab() {
  const count = useEditor((s) => captionClips(s.project).length);
  const empty = useEditor((s) => s.project.tracks.every((t) => t.clips.length === 0));
  const [language, setLanguage] = useState("english");
  const [model, setModel] = useState(ASR_MODELS[1].id);
  const [replace, setReplace] = useState(true);
  const [oneWord, setOneWord] = useState(false);
  const [busy, setBusy] = useState<TranscribeProgress | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const english = language === "english";
  const models = ASR_MODELS.filter((m) => (english ? true : !m.englishOnly));
  const chosen = models.find((m) => m.id === model) ?? models[0];

  const run = async () => {
    setBusy({ stage: "mixing", progress: 0 });
    await generateCaptions({ model: chosen.id, language: chosen.englishOnly ? null : language || null, replace, oneWord }, setBusy);
    setBusy(null);
  };

  return (
    <div className="lib-content captions-tab">
      <div className="cap-card">
        <header className="cap-head">
          <WandSparkles size={16} />
          <strong>Auto captions</strong>
        </header>
        <p className="lib-hint">Recognizes speech in your timeline and adds editable captions. Runs on this computer — no upload, no limit.</p>
        <label className="cap-field">
          <span>Spoken language</span>
          <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!busy}>
            {LANGUAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="cap-field">
          <span>Accuracy</span>
          <select className="field" value={chosen.id} onChange={(e) => setModel(e.target.value)} disabled={!!busy}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.size}
              </option>
            ))}
          </select>
        </label>
        <label className="cap-field row">
          <span>One word at a time</span>
          <Toggle label="One word at a time" on={oneWord} onChange={setOneWord} />
        </label>
        {count > 0 && (
          <label className="cap-field row">
            <span>Replace the {count} existing captions</span>
            <Toggle label="Replace existing captions" on={replace} onChange={setReplace} />
          </label>
        )}
        {busy ? (
          <div className="cap-progress">
            <div className="cap-progress-text">
              <span>{STAGE[busy.stage]}…</span>
              <span className="num">{Math.round(busy.progress * 100)}%</span>
            </div>
            <div className="cap-bar">
              <span style={{ transform: `scaleX(${busy.stage === "mixing" ? 0.05 : busy.progress})` }} />
            </div>
            <button className="btn ghost" onClick={cancelCaptions}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn primary cap-go" disabled={empty} onClick={() => void run()}>
            <Captions size={15} /> Generate captions
          </button>
        )}
        {/* Said in the card, not a tooltip: a disabled button gets no hover. */}
        {empty && !busy && <p className="lib-hint">Add a clip with speech to the timeline first.</p>}
        <p className="lib-hint">The first run downloads the speech model ({chosen.size}); after that it works offline.</p>
      </div>

      <div className="cap-card">
        <header className="cap-head">
          <Captions size={16} />
          <strong>Caption files</strong>
        </header>
        <div className="cap-actions">
          <button className="btn" onClick={() => file.current?.click()}>
            <Upload size={14} /> Import SRT or VTT
          </button>
          <button className="btn" disabled={!count} onClick={() => void exportCaptions("srt")}>
            <Download size={14} /> Export SRT
          </button>
          <button className="btn ghost" disabled={!count} onClick={() => void exportCaptions("vtt")}>
            Export VTT
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".srt,.vtt,text/vtt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importCaptions(f);
            e.target.value = "";
          }}
        />
        <p className="lib-hint">Select any caption on the timeline to edit its words, or restyle every caption at once from its Text tab.</p>
      </div>

      {count > 0 && <CaptionLooks />}
      {count > 0 && <FindReplace />}

      <TranscriptCard />
    </div>
  );
}

/** CapCut's caption Find and replace: fix a misheard name everywhere. */
function FindReplace() {
  const project = useEditor((s) => s.project);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(true);
  const o = { matchCase, wholeWord };
  const hits = find ? captionClips(project).reduce((n, c) => n + replaceText(c.text, find, replace, o)[1], 0) : 0;
  const run = () => {
    store.edit(`Replace "${find}"`, (p) => runCommand(p, "replace_caption_text", { find, replace, match_case: matchCase, whole_word: wholeWord }));
    toast(`Replaced ${hits} ${hits === 1 ? "match" : "matches"}`);
  };
  return (
    <div className="cap-card">
      <header className="cap-head">
        <Search size={16} />
        <strong>Find and replace</strong>
      </header>
      <label className="cap-field">
        <span>Find</span>
        <input className="field" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === "Enter" && hits && run()} />
      </label>
      <label className="cap-field">
        <span>Replace with</span>
        <input className="field" value={replace} onChange={(e) => setReplace(e.target.value)} onKeyDown={(e) => e.key === "Enter" && hits && run()} />
      </label>
      <label className="cap-field row">
        <span>Match case</span>
        <Toggle label="Match case" on={matchCase} onChange={setMatchCase} />
      </label>
      <label className="cap-field row">
        <span>Whole words</span>
        <Toggle label="Whole words" on={wholeWord} onChange={setWholeWord} />
      </label>
      <button className="btn primary cap-wide" disabled={!hits} onClick={run}>
        {find ? (hits ? `Replace ${hits} ${hits === 1 ? "match" : "matches"}` : "No matches") : "Replace"}
      </button>
    </div>
  );
}
