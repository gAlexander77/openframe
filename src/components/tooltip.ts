// One themed tooltip layer for the whole app (TermHQ's convention): any
// element with data-tip="..." shows it on hover after a short delay, or
// immediately on keyboard focus. Native `title` tooltips are slow, unstyled
// and ignore the dark theme, so they are not used.

const DELAY = 450;

export function installTooltips(): () => void {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let timer = 0;
  let target: HTMLElement | null = null;

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + t.height > window.innerHeight - 6) top = r.top - t.height - 8;
    const left = Math.min(Math.max(6, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 6);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };
  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text) return;
    tip.textContent = text;
    tip.classList.add("on");
    place(el);
  };
  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.classList.remove("on");
  };
  const find = (e: Event) => (e.target instanceof Element ? (e.target.closest("[data-tip]") as HTMLElement | null) : null);

  const over = (e: PointerEvent) => {
    const el = find(e);
    if (el === target) return;
    hide();
    if (!el || e.buttons) return;
    target = el;
    timer = window.setTimeout(() => target === el && el.isConnected && show(el), DELAY);
  };
  const focus = (e: FocusEvent) => {
    const el = find(e);
    if (el && el.matches(":focus-visible")) {
      target = el;
      show(el);
    }
  };
  const key = (e: KeyboardEvent) => e.key === "Escape" && tip.classList.contains("on") && hide();

  document.addEventListener("pointerover", over);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("focusin", focus);
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", key, true);
  window.addEventListener("blur", hide);
  return () => {
    document.removeEventListener("pointerover", over);
    document.removeEventListener("pointerdown", hide, true);
    document.removeEventListener("focusin", focus);
    document.removeEventListener("focusout", hide);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", hide);
    tip.remove();
  };
}
