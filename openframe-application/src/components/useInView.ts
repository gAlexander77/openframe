import { useEffect, useState, type RefObject } from "react";

/** Whether the element is on screen (or within `margin` of it), so library
 * cards make their thumbnails only when someone could see them. */
export function useInView(ref: RefObject<Element | null>, margin = "160px"): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries[entries.length - 1].isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return visible;
}
