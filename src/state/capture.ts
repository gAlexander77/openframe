// Record from the camera or the screen (CapCut's Record): MediaRecorder
// writes MP4 where the webview can (Chromium 126 and later), WebM
// otherwise. Stop imports the take like a dropped file and places it at
// the playhead where it started, by the same rules as a library drop.
// ponytail: the take is held in memory until Stop (a few hundred MB for a
// long 1080p screen recording); streaming it to the platform's media
// folder is the upgrade if long takes matter.

import { useSyncExternalStore } from "react";
import { addToTimeline, adoptAndImport } from "./media";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { toast } from "./toast";

export type CaptureKind = "camera" | "screen";
export type CapturePhase = { kind: "idle" } | { kind: "starting"; what: CaptureKind } | { kind: "recording"; what: CaptureKind; since: number } | { kind: "saving" };

let phase: CapturePhase = { kind: "idle" };
const listeners = new Set<() => void>();
const setPhase = (p: CapturePhase) => {
  phase = p;
  listeners.forEach((l) => l());
};
export const useCapture = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => phase);

/** Whether this webview can record the screen at all. */
export const canRecordScreen = () => typeof navigator.mediaDevices?.getDisplayMedia === "function";

/** MP4 first: it seeks without a scan and every target plays it. */
const TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

let rec: { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; at: number; what: CaptureKind } | null = null;

function release() {
  rec?.stream.getTracks().forEach((t) => t.stop());
  rec = null;
}

export async function startCapture(what: CaptureKind) {
  if (phase.kind !== "idle") return;
  setPhase({ kind: "starting", what });
  let stream: MediaStream;
  try {
    stream =
      what === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true })
        : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  } catch (e) {
    setPhase({ kind: "idle" });
    // Closing the picker or denying access is a choice, not an error.
    if (!(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError"))) toast(`Couldn't start recording: ${e instanceof Error ? e.message : e}`, "error");
    return;
  }
  // Canceled while the permission prompt was up.
  if (now().kind !== "starting") return void stream.getTracks().forEach((t) => t.stop());
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000 });
  rec = { recorder, stream, chunks: [], at: store.get().playhead, what };
  const take = rec;
  recorder.ondataavailable = (e) => e.data.size && take.chunks.push(e.data);
  // The browser's own "Stop sharing" bar ends a screen recording too.
  stream.getVideoTracks()[0]?.addEventListener("ended", () => void stopCapture());
  recorder.start(1000);
  setPhase({ kind: "recording", what, since: performance.now() });
}
// Read through a call: the phase changes across awaits.
const now = () => phase;

/** Stop and keep the take: imported and placed at the playhead where it
 * started. */
export async function stopCapture() {
  if (phase.kind !== "recording" || !rec) return;
  const take = rec;
  setPhase({ kind: "saving" });
  const stopped = new Promise((done) => (take.recorder.onstop = done));
  take.recorder.stop();
  await stopped;
  release();
  const type = take.recorder.mimeType || "video/webm";
  const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", "-");
  const file = new File(take.chunks, `${take.what === "camera" ? "Camera" : "Screen"} ${stamp}.${type.includes("mp4") ? "mp4" : "webm"}`, { type });
  try {
    if (projectWork.signal().aborted) return;
    const [asset] = await adoptAndImport([file]);
    if (asset) addToTimeline(asset, take.at);
    toast(`Recorded ${file.name}`);
  } catch (e) {
    toast(`Couldn't keep the recording: ${e instanceof Error ? e.message : e}`, "error");
  } finally {
    setPhase({ kind: "idle" });
  }
}

/** Stop without keeping anything. */
export function cancelCapture() {
  if (phase.kind !== "recording" && phase.kind !== "starting") return;
  if (rec) {
    rec.recorder.ondataavailable = null;
    if (rec.recorder.state !== "inactive") rec.recorder.stop();
  }
  release();
  setPhase({ kind: "idle" });
}
