import { useRef } from "react";

/** A drag handle between two panels. Reports pixel deltas while dragging;
 * the parent owns the sizes and their limits. Double-click resets. */
export function Splitter(props: {
  dir: "x" | "y";
  onDrag: (delta: number) => void;
  onReset?: () => void;
}) {
  const last = useRef(0);
  return (
    <div
      className={`splitter splitter-${props.dir}`}
      role="separator"
      aria-orientation={props.dir === "x" ? "vertical" : "horizontal"}
      onDoubleClick={props.onReset}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = props.dir === "x" ? e.clientX : e.clientY;
        e.currentTarget.classList.add("dragging");
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const pos = props.dir === "x" ? e.clientX : e.clientY;
        props.onDrag(pos - last.current);
        last.current = pos;
      }}
      onPointerUp={(e) => e.currentTarget.classList.remove("dragging")}
    />
  );
}
