import { useEffect, useRef } from "react";
import { rasterizeText, textFont } from "../engine/text";
import type { Project, TextClip } from "../lib/project/types";
import type { Layer } from "../lib/render/plan";
import { editBox } from "../lib/textBox";
import { beginTyping, endTyping, typeText } from "../state/textEdit";

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

  const s = clip.style;
  const b = editBox(rasterizeText(clip, project.width, project.height).layout, s.align, layer, { width, height }, project.width);

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
      // ponytail: CapCut's Enter splits the caption at the caret; until that
      // lands it finishes the caption, as the inspector's caption list does.
      e.preventDefault();
      endTyping();
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
          font: textFont(s, b.fontSize),
          lineHeight: `${b.lineHeight}px`,
          letterSpacing: `${b.letterSpacing}px`,
          textAlign: s.align,
        }}
      />
    </div>
  );
}
