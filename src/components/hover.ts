// Hover popovers for the sidebar: open after a short hover, stay open while the pointer is over the
// trigger or the popover, close shortly after it leaves both.
import { useEffect, useRef, useState } from "react";

/**
 * An element's box in window pixels. The sidebar is zoomed and WebKit may report boxes inside it
 * unzoomed, so they're scaled against the sidebar's unzoomed wrapper.
 */
export function windowRect(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const r = el.getBoundingClientRect();
  const wrap = el.closest(".sidebar-wrap")?.getBoundingClientRect();
  const aside = el.closest(".sidebar")?.getBoundingClientRect();
  if (!wrap || !aside?.height) return r;
  const k = wrap.height / aside.height;
  const x = (v: number) => wrap.left + (v - aside.left) * k;
  const y = (v: number) => wrap.top + (v - aside.top) * k;
  return { left: x(r.left), right: x(r.right), top: y(r.top), bottom: y(r.bottom) };
}

/**
 * State for a popover anchored to `trigger`. `place` turns the trigger into the popover's position
 * when it opens. Follows the pointer itself rather than enter/leave events, which misfire across the
 * portal and the zoomed sidebar.
 */
export function useHoverPopover<A, T extends HTMLElement = HTMLElement>(place: (trigger: T) => A | null) {
  const [anchor, setAnchor] = useState<A | null>(null);
  const trigger = useRef<T>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (anchor === null) return;
    const onMove = (e: PointerEvent) => {
      const over = [trigger.current, panel.current].some((el) => el?.contains(e.target as Node));
      window.clearTimeout(timer.current);
      if (!over) timer.current = window.setTimeout(() => setAnchor(null), 300);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.clearTimeout(timer.current);
    };
  }, [anchor]);

  const onMouseEnter = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => trigger.current && setAnchor(place(trigger.current)), 250);
  };
  const onMouseLeave = () => anchor === null && window.clearTimeout(timer.current);
  return { anchor, trigger, panel, onMouseEnter, onMouseLeave, close: () => setAnchor(null) };
}
