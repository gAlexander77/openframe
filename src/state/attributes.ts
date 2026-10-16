import { useSyncExternalStore } from "react";
import { copyAttributes, type AttributeClipboard } from "../lib/attributes";
import { store } from "./store";
import { toast } from "./toast";
let copied: AttributeClipboard | null = null;
const listeners = new Set<() => void>();
export function copyClipAttributes(id: string) { copied = copyAttributes(store.get().project, id); listeners.forEach((l) => l()); toast("Attributes copied"); }
export function useCopiedAttributes() { return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => copied); }
