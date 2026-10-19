import { useState, type InputHTMLAttributes } from "react";
import { boundedNumber } from "../lib/numberInput";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onInput"> & {
  value: number | "";
  onCommit: (value: number | "") => void;
  optional?: boolean;
  integer?: boolean;
};

export function DraftNumber({ value, onCommit, optional, integer, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = boundedNumber(draft, Number(props.min ?? -Infinity), Number(props.max ?? Infinity), integer);
    setDraft(null);
    if (optional && !draft.trim()) onCommit("");
    else if (n !== null) onCommit(n);
  };
  return <input {...props} type="number" value={draft ?? value}
    onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); e.currentTarget.blur(); } }} />;
}
