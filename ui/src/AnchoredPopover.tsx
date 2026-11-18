import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Portalled so the sidebar and composer cannot clip it. Keep it inside the
 * viewport even when a long account name or a live usage report changes it. */
export function AnchoredPopover({
  anchor,
  label,
  children,
  onClose,
  side = "above",
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  onClose(): void;
  side?: "above" | "right";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [at, setAt] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const el = panel.current;
    const trigger = anchor.current;
    if (!el || !trigger) return;
    const position = () => {
      const r = trigger.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      const left = side === "right" && r.right + p.width + 16 <= innerWidth ? r.right + 8 : r.left;
      const top = side === "above" && r.top >= p.height + 16 ? r.top - p.height - 8 : r.bottom + 8;
      setAt({ left: Math.max(8, Math.min(left, innerWidth - p.width - 8)), top: Math.max(8, Math.min(top, innerHeight - p.height - 8)) });
    };
    position();
    el.querySelector<HTMLElement>("button, input, [tabindex='0']")?.focus();
    const resize = new ResizeObserver(position);
    resize.observe(el);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select, a[href], [tabindex='0']")];
      const next = e.shiftKey ? items[items.length - 1] : items[0];
      if (next && (e.shiftKey ? document.activeElement === items[0] : document.activeElement === items[items.length - 1])) {
        e.preventDefault();
        next.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("keydown", key, true);
      if (trigger.isConnected) trigger.focus();
    };
  }, [anchor, side]);
  return createPortal(
    <>
      <div className="anchored-scrim" onPointerDown={onClose} />
      <div ref={panel} className="anchored-popover" role="dialog" aria-modal="true" aria-label={label} style={at}>
        {children}
      </div>
    </>,
    document.body,
  );
}
