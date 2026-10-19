import { useState } from "react";
import { Diamond, Spline } from "../../icons";
import { presetOf, setEase, toggleKeysAt } from "../../lib/keyframeEdit";
import { findClip, updateClip } from "../../lib/project/ops";
import type { Clip } from "../../lib/project/types";
import { withKeys } from "../../state/keyframes";
import { store } from "../../state/store";
import { EaseMenu } from "../EaseMenu";
import { useRel } from "./controls";

/** CapCut's section-header diamond: keys every property of the section at
 * the playhead in one click, or removes them all when every one is keyed
 * there. Half-lit when only some are. */
export function SectionKey({ clip, paths, title }: { clip: Clip; paths: string[]; title: string }) {
  const rel = useRel(clip);
  const keyed = paths.filter((p) => clip.keyframes?.[p]?.some((k) => k.f === rel)).length;
  const all = keyed === paths.length;
  const label = all ? `Remove ${title.toLowerCase()} keyframes` : `Keyframe all ${title.toLowerCase()} properties`;
  return (
    <button
      className={`key-toggle section-key${all ? " on" : keyed ? " some" : ""}`}
      aria-label={label}
      data-tip={label}
      onClick={(e) => {
        e.stopPropagation();
        store.edit(all ? "Remove keyframes" : "Add keyframes", (p) => updateClip(p, clip.id, (c) => toggleKeysAt(c, paths, rel)));
      }}
    >
      <Diamond size={12} fill={all ? "currentColor" : "none"} />
    </button>
  );
}

/** The easing of the keyframe under the playhead, as a small button beside
 * the ‹ ◇ › cluster; it opens the preset menu. */
export function EaseButton({ clip, path, f }: { clip: Clip; path: string; f: number }) {
  const [at, setAt] = useState<{ x: number; y: number; above: number } | null>(null);
  const key = clip.keyframes?.[path]?.find((k) => k.f === f);
  if (!key) return <span className="key-ease" />;
  const name = presetOf(key.ease)?.label ?? "Custom curve";
  return (
    <>
      <button
        className={`key-ease${key.ease && key.ease !== "linear" ? " eased" : ""}`}
        aria-label={`Easing: ${name}`}
        data-tip={`Easing: ${name}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.right - 300, y: r.bottom + 4, above: r.top - 4 });
        }}
      >
        <Spline size={11} />
      </button>
      {at && (
        <EaseMenu
          x={at.x}
          y={at.y}
          above={at.above}
          current={key.ease}
          onPick={(ease) =>
            store.edit("Easing", (p) => {
              const c = findClip(p, clip.id)?.clip;
              return c?.keyframes ? withKeys(p, clip.id, setEase(c.keyframes, [{ path, f }], ease)) : p;
            })
          }
          onClose={() => setAt(null)}
        />
      )}
    </>
  );
}
