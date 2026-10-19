import { useEffect, useRef } from "react";
import { rasterizeText, textFamily } from "../engine/text";
import { player } from "../engine/player";
import type { Project, TextClip } from "../lib/project/types";
import type { Layer } from "../lib/render/plan";
import { editBox } from "../lib/textBox";
import { fontWeight } from "../lib/textLook";
import { beginTyping, endTyping, splitCaptionAt, typeText } from "../state/textEdit";
import { useEditor } from "../state/store";

/** Room between the text and the frame, viewer pixels: the raster's own pad
 * is a pixel or two, which puts a caret at either end on the border. */
const MARGIN = 6;

/**
 * CapCut's on-canvas text editing: a transparent textarea laid over the text
 * the engine drew, in the same font, size, spacing and turn, so only its
 * caret and selection show (ADR-030). The engine keeps drawing the real
 * text underneath from the project, which every keystroke updates, so what
 * you see while typing is what exports. Opens with everything selected.
 */
export function TextEditor({ clip, layer, project, width, height }: { clip: TextClip; layer: Layer; project: Project; width: number; height: number }) {
  const frame = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const previewScale = useEditor((s) => s.previewScale);

  useEffect(() => {
    const el = frame.current!;
    area.current!.focus({ preventScroll: true });
    area.current!.select();
    beginTyping(clip.id, el);
    // A real unmount (not StrictMode's rehearsal) ends the session.
    return () => {
      if (!el.isConnected) endTyping();
    };
  }, [clip.id]);

  // The title as drawn at this frame: keyed size, spacing and color applied
  // (ADR-071), so the caret sits on the letters the viewer shows.
  const shown = layer.source.kind === "text" ? layer.source.clip : clip;
  const s = shown.style;
  // Layout at the renderer's target: raster rounding and font metrics at
  // preview resolution differ from a scaled full-project raster.
  const target = player.renderSize(project, previewScale);
  const b = editBox(rasterizeText(shown, target.w, target.h).layout, s.align, layer, { width, height }, target.w);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      // Done, and the clip stays selected: the keymap's Escape would deselect.
      e.preventDefault();
      e.stopPropagation();
      endTyping();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      // CapCut's line break inside a caption; a textarea ignores Ctrl+Enter.
      // insertText keeps the textarea's own undo history.
      e.preventDefault();
      document.execCommand("insertText", false, "\n");
    } else if (e.key === "Enter" && !e.shiftKey && clip.caption) {
      // CapCut's Enter splits the caption at the caret, where the next word
      // is spoken, and typing goes on in the second half. At either end
      // there is nothing to split, and it just finishes.
      e.preventDefault();
      const caret = e.currentTarget.selectionStart;
      endTyping();
      splitCaptionAt(clip.id, caret);
    }
  };

  return (
    <div
      className="te-frame"
      ref={frame}
      style={{ left: b.cx, top: b.cy, width: b.width + MARGIN * 2, height: b.height + MARGIN * 2, transform: `translate(-50%, -50%) rotate(${b.rotation}deg)` }}
      onPointerDown={(e) => e.stopPropagation()}
      // A press on the frame's edge keeps the caret where it was.
      onMouseDown={(e) => e.target !== area.current && e.preventDefault()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={area}
        className="te-text"
        value={clip.text}
        spellCheck={false}
        aria-label="Text"
        onChange={(e) => {
          beginTyping(clip.id, frame.current!);
          typeText(e.target.value);
        }}
        onKeyDown={onKey}
        // Switching windows blurs too; the session waits for the return.
        onBlur={() => document.hasFocus() && endTyping()}
        style={{
          left: b.left + MARGIN,
          top: b.top + MARGIN,
          width: b.textWidth,
          height: b.textHeight,
          clipPath: `inset(0 ${b.clipRight}px 0 ${b.clipLeft}px)`,
          // Longhands: the font shorthand would reset line-height whenever it
          // alone changed between renders.
          fontFamily: textFamily(s),
          fontSize: b.fontSize,
          fontWeight: fontWeight(s),
          fontStyle: s.italic ? "italic" : "normal",
          lineHeight: `${b.lineHeight}px`,
          letterSpacing: `${b.letterSpacing}px`,
          // The typed text shows in the style's case, as the canvas draws it.
          textTransform: clip.style.case === "upper" ? "uppercase" : clip.style.case === "lower" ? "lowercase" : clip.style.case === "title" ? "capitalize" : undefined,
          textAlign: s.align,
        }}
      />
    </div>
  );
}
