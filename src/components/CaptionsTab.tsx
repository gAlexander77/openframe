import { useRef, useState } from "react";
import { ASR_MODELS, type TranscribeProgress } from "../engine/transcribe";
import { Captions, Download, Upload, WandSparkles } from "../icons";
import { cancelCaptions, captionClips, exportCaptions, generateCaptions, importCaptions } from "../state/captions";
import { useEditor } from "../state/store";
import { Toggle } from "./inspector/controls";

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
    </div>
  );
}
