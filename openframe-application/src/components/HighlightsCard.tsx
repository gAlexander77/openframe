import { useState } from "react";
import { Play, Sparkles } from "../icons";
import { formatDuration } from "../lib/time";
import { addHighlightMarkers, cancelHighlights, findAssetHighlights, seekHighlight, useHighlights } from "../state/highlights";
import { useEditor } from "../state/store";
import { toast } from "../state/toast";
import { platform } from "../platform";

export function HighlightsCard() {
  const project = useEditor(s => s.project);
  const selection = useEditor(s => s.selection);
  const state = useHighlights();
  const [assetId, setAssetId] = useState("");
  const [count, setCount] = useState(10), [min, setMin] = useState(15), [max, setMax] = useState(60);
  const [transcribe, setTranscribe] = useState(false);
  const [chat, setChat] = useState<{ name: string; text: string } | null>(null);
  const selected = project.tracks.flatMap(t => t.clips).find(c => selection.includes(c.id) && "assetId" in c);
  const media = project.assets.filter(a => a.hasAudio || a.hasVideo);
  const chosen = assetId || (selected && "assetId" in selected ? selected.assetId : media[0]?.id) || "";
  const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === selected?.id && "assetId" in c && c.assetId === chosen)
    ?? project.tracks.flatMap(t => t.clips).find(c => "assetId" in c && c.assetId === chosen);
  const report = (e: unknown) => toast(e instanceof Error ? e.message : String(e), "error");
  const result = state.result;
  return <section className="ai-card ai-highlights" aria-label="Find highlights">
    <div className="ai-card-head">
      <div className="ai-icon"><Sparkles size={20} strokeWidth={1.7} /></div>
      <div className="ai-card-text"><h3>Find highlights</h3><p>Find exciting moments in a long stream. Chat replay helps.</p></div>
    </div>
    <div className="highlight-fields">
      <label>Media<select aria-label="Highlight media" value={chosen} disabled={state.busy} onChange={e => setAssetId(e.target.value)}>
        {!media.length && <option value="">Import a VOD first</option>}
        {media.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></label>
      <div className="highlight-numbers">
        <label>Count<input aria-label="Highlight count" type="number" min={1} max={100} value={count} disabled={state.busy} onChange={e => setCount(+e.target.value)} /></label>
        <label>Min seconds<input aria-label="Minimum highlight length" type="number" min={1} max={300} value={min} disabled={state.busy} onChange={e => setMin(+e.target.value)} /></label>
        <label>Max seconds<input aria-label="Maximum highlight length" type="number" min={min} max={300} value={max} disabled={state.busy} onChange={e => setMax(+e.target.value)} /></label>
      </div>
      <div className="highlight-chat">
        <button className="btn" disabled={state.busy} onClick={() => void platform.openChatReplay().then(file => { if (file) setChat(file); }).catch(report)}>Choose chat replay</button>
        {chat && <button className="btn" disabled={state.busy} aria-label="Remove chat replay" onClick={() => setChat(null)}>Remove</button>}
        <span title={chat?.name}>{chat?.name ?? "Optional JSON or text"}</span>
      </div>
      <label className="highlight-transcribe"><input type="checkbox" checked={transcribe} disabled={state.busy} onChange={e => setTranscribe(e.target.checked)} />Hear candidates for quotes and sentence boundaries</label>
    </div>
    <div className="ai-card-foot">
      {state.busy ? <><progress aria-label="Highlight analysis progress" max={1} value={state.progress} /><button className="btn" onClick={cancelHighlights}>Cancel</button></>
        : <button className="btn ai-run" disabled={!chosen || !Number.isInteger(count) || count < 1 || count > 100 || min < 1 || max < min || max > 300} onClick={() => void findAssetHighlights({ ...(clip ? { clip_id: clip.id } : { asset_id: chosen }), count, min_length: min, max_length: max, transcribe }, chat?.text).catch(report)}>Run</button>}
      {result && <button className="btn" disabled={state.busy || !result.highlights.length || !result.clip_id} onClick={() => { try { addHighlightMarkers(result); } catch (e) { report(e); } }}>Add markers</button>}
    </div>
    {state.busy && <p className="highlight-status" role="status">{state.stage} {Math.round(state.progress * 100)}%</p>}
    {state.error && <p className="highlight-status" role="alert">{state.error}</p>}
    {result && <>
      <p className="highlight-status" role="status">{result.highlights.length} highlights · {result.elapsed_seconds.toFixed(1)} s · {result.signals.join(", ")}</p>
      <ol className="highlight-results">
        {result.highlights.map(h => <li key={`${h.rank}-${h.peak}`}>
          <button className="highlight-pick" onClick={() => seekHighlight(result, h)} aria-label={`Select highlight ${h.rank}`}>
            <strong>{h.title ?? `Highlight ${h.rank}`}</strong><span>{formatDuration(h.start)}–{formatDuration(h.end)}</span>
          </button>
          <div className="highlight-score"><meter aria-label={`Highlight ${h.rank} score`} min={0} max={1} value={h.score} /><span>{Math.round(h.score * 100)}%</span><button className="icon-btn" aria-label={`Play highlight ${h.rank} from here`} onClick={() => seekHighlight(result, h, true)}><Play size={14} /></button></div>
          <p>{h.reasons.join("; ")}</p>
          {h.snippet && <p className="highlight-snippet">{h.snippet}</p>}
        </li>)}
      </ol>
    </>}
  </section>;
}
