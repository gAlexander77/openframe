// The library's Check tab (ADR-111): the project check agents run
// (check_project), shown to a person. Pick what is being made, run it
// (it renders frames, so only on request), and read what it found in
// plain words, grouped as text, timing and sound; a finding jumps the
// playhead to its time, selects its clip and opens the inspector tab that
// fixes it. The work is in src/state/check.ts, the words in
// src/lib/checkFindings.ts.

import { useState } from "react";
import { Check, CircleAlert, ListChecks, Loader2, X } from "../icons";
import { CHECK_KINDS, checkHeadline, groupFindings, notChecked, personFindings, type PersonFinding } from "../lib/checkFindings";
import type { CheckKind } from "../lib/designCheck";
import { findClip } from "../lib/project/ops";
import { formatTimecode, secondsToFrames } from "../lib/time";
import { cancelCheck, checkStore, runCheck, useCheck, type CheckRun } from "../state/check";
import { documentOf, store, useEditor } from "../state/store";
import { EmptyState } from "./EmptyState";
import { showInspectorTab } from "./inspector/Inspector";
import { revealPlayhead } from "./Timeline";
import "./check.css";

const LEVEL = { error: "Error", warning: "Warning", tip: "Tip" } as const;

/** Go to a finding: the project's own timeline, its clip selected with
 * the tab that fixes it, the playhead at its time and in view. */
function goTo(f: PersonFinding) {
  if (store.get().nest.length) store.closeCompound(0);
  // A finding of no clip (a gap, the fonts) leaves no clip selected: the
  // inspector would show one it is not about.
  const clip = f.clipId && findClip(store.get().project, f.clipId) ? f.clipId : null;
  store.select(clip ? [clip] : []);
  if (clip && f.tab) showInspectorTab(f.tab);
  if (f.at !== undefined) store.seek(secondsToFrames(f.at, store.get().project.fps));
  revealPlayhead();
}

export function CheckTab() {
  const kind = useCheck((s) => s.kind);
  const job = useCheck((s) => s.job);
  const error = useCheck((s) => s.error);
  const last = useCheck((s) => s.last);
  const docId = useEditor((s) => documentOf(s).id);
  const revision = useEditor((s) => s.revision);
  const run = last && last.projectId === docId ? last : null;
  const hint = CHECK_KINDS.find((k) => k.id === kind)?.hint;
  return (
    <div className="lib-content check-tab">
      <div className="check-toolbar">
        <label className="check-kind">
          <span>Made as</span>
          <select className="field" aria-label="What you are making" value={kind} disabled={!!job} onChange={(e) => checkStore.setKind(e.target.value as CheckKind)}>
            {CHECK_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
        </label>
        <button className="btn primary check-run" disabled={!!job} onClick={() => void runCheck(kind)}>
          {run ? "Check again" : "Check project"}
        </button>
      </div>
      {/* Said until a check of this kind is showing: in a 720 px window
          the findings need its line. */}
      {(!run || run.kind !== kind) && <p className="lib-hint">{hint}</p>}
      {job && (
        <div className="check-progress" role="status" aria-live="polite">
          <div className="check-bar" role="progressbar" aria-label="Check progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.fraction * 100)}>
            <span style={{ transform: `scaleX(${job.fraction})` }} />
          </div>
          <span className="check-stage">
            <Loader2 size={13} className="spin" /> <span data-cut>{job.stage}</span>
          </span>
          <button className="icon-btn small" aria-label="Cancel the check" data-tip="Cancel" onClick={cancelCheck}>
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <p className="check-error" role="alert">
          <CircleAlert size={14} /> {error}
        </p>
      )}
      {!run && !job && (
        <EmptyState
          icon={<ListChecks size={24} />}
          title="Check the edit before you export"
          hint="Finds text cut off, too small or hard to read, black gaps, sound cut off mid-sound and more, each with how to fix it. It measures the rendered picture, so it takes a moment."
        />
      )}
      {run && <Report run={run} stale={run.revision !== revision} />}
    </div>
  );
}

function Report({ run, stale }: { run: CheckRun; stale: boolean }) {
  const [visited, setVisited] = useState<string | null>(null);
  const { summary } = run.report;
  const head = checkHeadline(summary);
  const groups = groupFindings(personFindings(run.doc, run.report.findings, summary.duration));
  const kind = CHECK_KINDS.find((k) => k.id === run.kind)?.label ?? "General video";
  const fps = run.doc.fps;
  return (
    <>
      <div className={`check-summary ${head.tone}`} role="status">
        {head.tone === "ok" ? <Check size={16} strokeWidth={2.4} /> : <CircleAlert size={16} />}
        <div>
          <strong>{head.text}</strong>
          <small>
            {kind} · {summary.shots} {summary.shots === 1 ? "shot" : "shots"} · {summary.titles} {summary.titles === 1 ? "title" : "titles"}
            {summary.captions ? ` · ${summary.captions} ${summary.captions === 1 ? "caption" : "captions"}` : ""}
          </small>
          {stale && <small className="check-stale">The project changed since this check: check again to see the changes.</small>}
        </div>
      </div>
      {groups.map((g) => (
        <section className="check-group" key={g.id} aria-labelledby={`check-${g.id}`}>
          <h3 className="check-group-head" id={`check-${g.id}`}>
            <span>{g.label}</span>
            <span className={`check-count${g.findings.length ? "" : " none"}`} aria-label={`${g.findings.length} found`}>{g.findings.length}</span>
          </h3>
          {g.findings.length ? (
            <ul className="check-list">
              {g.findings.map((f) => {
                const time = f.at !== undefined ? formatTimecode(secondsToFrames(f.at, fps), fps) : null;
                const body = (
                  <>
                    <span className={`check-level ${f.level}`}>{LEVEL[f.level]}</span>
                    <span className="check-text">
                      <strong>{f.title}</strong>
                      {f.detail && <span className="check-detail">{f.detail}</span>}
                      {f.action && <span className="check-action">{f.action}</span>}
                    </span>
                    {time && <small className="check-time num">{time}</small>}
                  </>
                );
                return (
                  <li key={f.key} className={`check-row${visited === f.key ? " on" : ""}`} data-rule={f.rule}>
                    {f.at !== undefined || f.clipId ? (
                      <button
                        className="check-jump"
                        aria-current={visited === f.key ? "true" : undefined}
                        aria-label={`${f.title}${time ? `, at ${time}` : ""}. ${f.action}`}
                        onClick={() => {
                          setVisited(f.key);
                          goTo(f);
                        }}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="check-jump static">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="check-none">
              <Check size={13} strokeWidth={2.4} /> Nothing found
            </p>
          )}
        </section>
      ))}
      <ul className="check-foot">
        {notChecked(run.report).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}
