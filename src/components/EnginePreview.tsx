// A library card's picture, rendered by the engine (src/engine/previews.ts):
// asked for only while the card is on screen, faded in when it lands, and on
// hover swapped for a sprite strip that CSS steps through. Reduced motion
// keeps the still.

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { previewKey, previewMotion, previewScene, previewStill, subscribePreviewScene, type PreviewMotion, type PreviewSpec } from "../engine/previews";
import { useInView } from "./useInView";

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function EnginePreview({ spec, shape = "square" }: { spec: PreviewSpec; shape?: "square" | "wide" }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  const onScreen = useRef(visible);
  onScreen.current = visible;
  useSyncExternalStore(subscribePreviewScene, previewScene);
  const key = previewKey(spec, shape);
  const specRef = useRef(spec);
  specRef.current = spec;

  const [still, setStill] = useState<string | null>(null);
  const [motion, setMotion] = useState<{ key: string; m: PreviewMotion } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    void previewStill(specRef.current, shape, () => live && onScreen.current).then((u) => live && u && setStill(u));
    return () => {
      live = false;
    };
  }, [key, shape, visible]);

  useEffect(() => {
    const card = ref.current?.closest(".card");
    if (!card) return;
    const enter = () => {
      if (reducedMotion()) return;
      void previewMotion(specRef.current, shape, () => card.matches(":hover")).then((m) => m && setMotion({ key, m }));
    };
    card.addEventListener("pointerenter", enter);
    return () => card.removeEventListener("pointerenter", enter);
  }, [key, shape]);

  const m = motion?.key === key ? motion.m : null;
  const style = {
    backgroundImage: still ? `url(${still})` : undefined,
    ...(m ? { "--sprite": `url(${m.sprite})`, "--frames": m.frames, "--steps": m.frames, "--dur": `${m.seconds}s` } : {}),
  } as CSSProperties;
  return <div ref={ref} className={`eng-preview${still ? " ready" : ""}${m ? " has-motion" : ""}`} style={style} />;
}
