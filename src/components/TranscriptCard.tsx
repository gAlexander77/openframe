import { useEffect, useRef } from "react";
import { ScrollText } from "../icons";
import * as ops from "../lib/project/ops";
import type { Id } from "../lib/project/types";
import { store, useEditor } from "../state/store";
import { cancelTranscript, clipWords, deleteWords, speechClips, transcribeTrack, transcribing, useTranscriptVersion, wordFrame } from "../state/transcript";

/** Whether the selection covers part of a word's own text: touching its
 * edge (a drag that stops at the next word) does not count. */
function picked(r: Range, span: Element) {
  const t = span.firstChild;
  if (!t) return false;
  const len = t.textContent?.length ?? 0;
  if (r.comparePoint(t, len) < 0 || r.comparePoint(t, 0) > 0) return false;
  return !(r.endContainer === t && r.endOffset === 0) && !(r.startContainer === t && r.startOffset === len);
}

/** Edit by transcript: the selected clip's track as text, clip by clip.
 * Select words and press Delete to cut them; click a word to go there. */
export function TranscriptCard() {
  useTranscriptVersion();
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const sel = selection.length ? ops.findClip(project, selection[0]) : null;
  const track = sel && (sel.clip.type === "video" || sel.clip.type === "audio") ? sel.track : ops.mainTrack(project);
  const clips = speechClips(project, track);
  const texts = clips.map((c) => [c, clipWords(project, c)] as const);
  const unheard = texts.filter(([, w]) => !w).length;
  const running = transcribing();

  // The word under the playhead lights up, without re-rendering the text.
  useEffect(() => {
    let lit: Element | null = null;
    const update = () => {
      const s = store.get();
      const c = clips.find((x) => s.playhead >= x.start && s.playhead < x.start + x.duration);
      const words = c && clipWords(s.project, c);
      const t = c && ops.sourceTimeAt(c, s.playhead, s.project.fps);
      const i = words && t !== undefined ? words.findIndex((w) => t >= w.start && t < w.end) : -1;
      const el = c && i >= 0 ? (ref.current?.querySelector(`[data-tclip="${c.id}"] [data-i="${i}"]`) ?? null) : null;
      if (el === lit) return;
      lit?.classList.remove("now");
      el?.classList.add("now");
      lit = el;
    };
    update();
    return store.subscribe(update);
  });

  const cut = () => {
    const s = getSelection();
    if (!s || s.isCollapsed || !ref.current) return;
    const r = s.getRangeAt(0);
    const picks = new Map<Id, Set<number>>();
    for (const span of ref.current.querySelectorAll("[data-i]")) {
      if (!picked(r, span)) continue;
      const id = (span.closest("[data-tclip]") as HTMLElement).dataset.tclip!;
      if (!picks.has(id)) picks.set(id, new Set());
      picks.get(id)!.add(Number((span as HTMLElement).dataset.i));
    }
    s.removeAllRanges();
    deleteWords(picks);
  };

  return (
    <div className="cap-card transcript-card">
      <header className="cap-head">
        <ScrollText size={16} />
        <strong>Edit by transcript</strong>
      </header>
      <p className="lib-hint">
        {clips.length ? `${track.name}: select words and press Delete to cut them; click a word to go there.` : "Add a clip with speech to the timeline first."}
      </p>
      {unheard > 0 &&
        (running ? (
          <button className="btn ghost" onClick={cancelTranscript}>
            Cancel
          </button>
        ) : (
          <button className="btn primary cap-go" onClick={() => void transcribeTrack(track.id)}>
            <ScrollText size={15} /> Transcribe {unheard === 1 ? "1 clip" : `${unheard} clips`}
          </button>
        ))}
      {texts.some(([, w]) => w?.length) && (
        <>
          <div
            className="transcript"
            ref={ref}
            tabIndex={0}
            aria-label="Transcript"
            onKeyDown={(e) => {
              if (e.key !== "Delete" && e.key !== "Backspace") return;
              // Not the timeline's Delete, which would remove the clip.
              e.preventDefault();
              e.stopPropagation();
              cut();
            }}
          >
            {texts.map(
              ([c, words]) =>
                words && (
                  <p key={c.id} data-tclip={c.id}>
                    {words.map((w, i) => (
                      <span key={i}>
                        <span data-i={i} onClick={() => getSelection()?.isCollapsed && store.seek(wordFrame(project, c, w))}>
                          {w.text.trim()}
                        </span>{" "}
                      </span>
                    ))}
                  </p>
                ),
            )}
          </div>
          <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={cut}>
            Delete selected words
          </button>
        </>
      )}
    </div>
  );
}
