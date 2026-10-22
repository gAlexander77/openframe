// Preferences (Premiere's Edit > Preferences > Timeline): how long new
// stills, titles and effect layers, and transitions start, and whether
// dragging the playhead sounds (audio scrubbing, ADR-079). Per viewer,
// like the keymap and the layout, never in a project; a project keeps the
// lengths its clips were given.

import { useSyncExternalStore } from "react";
import { TRANSITIONS } from "../lib/catalog";
import { setTransitionDefaults } from "../lib/defaultTransitions";
import { setStillSeconds } from "../lib/project/defaults";

export interface Prefs {
  /** Pictures added from the library. */
  stillSeconds: number;
  /** Titles, stickers, effects, filters and adjustment layers. */
  layerSeconds: number;
  transitionSeconds: number;
  transitionType: string;
  audioCrossfadeSeconds: number;
  /** Short snippets of sound while the playhead is dragged (CapCut, Premiere). */
  audioScrub: boolean;
}

export type SecondsPref = "stillSeconds" | "layerSeconds" | "transitionSeconds" | "audioCrossfadeSeconds";

export const DEFAULT_PREFS: Prefs = { stillSeconds: 5, layerSeconds: 3, transitionSeconds: 0.5, transitionType: "dissolve", audioCrossfadeSeconds: 0.5, audioScrub: true };

export const PREF_LIMITS: Record<SecondsPref, [number, number]> = {
  stillSeconds: [0.5, 60],
  layerSeconds: [0.5, 60],
  transitionSeconds: [0.1, 5],
  audioCrossfadeSeconds: [0.05, 2],
};

const KEY = "ve.prefs";
const clean = (v: Partial<Prefs>): Prefs => {
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(PREF_LIMITS) as SecondsPref[]) {
    const x = Number(v[k]);
    if (Number.isFinite(x)) out[k] = Math.min(PREF_LIMITS[k][1], Math.max(PREF_LIMITS[k][0], x));
  }
  if (typeof v.transitionType === "string" && Object.hasOwn(TRANSITIONS, v.transitionType)) out.transitionType = v.transitionType;
  if (typeof v.audioScrub === "boolean") out.audioScrub = v.audioScrub;
  return out;
};

let prefs: Prefs = (() => {
  try {
    return clean(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return DEFAULT_PREFS;
  }
})();
setStillSeconds(prefs.stillSeconds);
setTransitionDefaults({ type: prefs.transitionType, videoSeconds: prefs.transitionSeconds, audioSeconds: prefs.audioCrossfadeSeconds });
const listeners = new Set<() => void>();

export const prefsStore = {
  get: () => prefs,
  set(patch: Partial<Prefs>) {
    prefs = clean({ ...prefs, ...patch });
    setStillSeconds(prefs.stillSeconds);
    setTransitionDefaults({ type: prefs.transitionType, videoSeconds: prefs.transitionSeconds, audioSeconds: prefs.audioCrossfadeSeconds });
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // Private windows may refuse storage; the choice holds for this session.
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export const usePrefs = () => useSyncExternalStore(prefsStore.subscribe, prefsStore.get);
