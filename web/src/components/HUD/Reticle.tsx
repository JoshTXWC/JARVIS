/**
 * TARGETING RETICLE — cursor follow with magnetic lock-on.
 * Snaps to buttons / inputs / chips within a radius and holds with
 * hysteresis so the frame doesn't flicker off edges.
 *
 * While locked, clicks activate the framed target even if the OS pointer
 * is outside it. The system cursor is hidden — the reticle is the cursor.
 */
import { useEffect, useRef, useState } from "react";

const LOCK_SEL =
  'button, a, input, textarea, select, [role="button"], [data-reticle], .nav-pill, .glass-chip, .soft-field, .glass-btn';

const SNAP_PX = 36;       // magnetic pull distance to edges
const HOLD_PAD = 18;      // extra padding before unlock (hysteresis)
const FRAME_PAD = 10;     // visual frame padding around target
const FREE_SIZE = 28;
const HUD_CURSOR_CLASS = "jarvis-reticle-hud";

function distToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function isVisible(el: HTMLElement): boolean {
  const st = getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

function findLockTarget(x: number, y: number, sticky: HTMLElement | null): HTMLElement | null {
  // Sticky hold — stay locked while pointer is near the previous target.
  if (sticky && document.contains(sticky) && isVisible(sticky)) {
    const r = sticky.getBoundingClientRect();
    const expanded = {
      left: r.left - HOLD_PAD,
      top: r.top - HOLD_PAD,
      right: r.right + HOLD_PAD,
      bottom: r.bottom + HOLD_PAD,
    };
    if (
      x >= expanded.left && x <= expanded.right &&
      y >= expanded.top && y <= expanded.bottom
    ) {
      return sticky;
    }
  }

  const under = document.elementFromPoint(x, y);
  const direct = under?.closest(LOCK_SEL) as HTMLElement | null;
  if (direct && isVisible(direct)) return direct;

  // Magnetic edge snap — nearest candidate within SNAP_PX of its border.
  let best: HTMLElement | null = null;
  let bestDist = SNAP_PX;
  const nodes = document.querySelectorAll(LOCK_SEL);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
    const d = distToRect(x, y, r);
    if (d < bestDist) {
      bestDist = d;
      best = el;
    }
  }
  return best;
}

function targetLabel(el: HTMLElement): string {
  return (
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.placeholder
      : "") ||
    (el.textContent || "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28);
}

function activateLocked(target: HTMLElement) {
  if (!document.contains(target)) return;
  try {
    if (typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  } catch {
    try { target.focus(); } catch { /* noop */ }
  }
  if (typeof target.click === "function") {
    target.click();
  }
}

export default function Reticle() {
  const ref = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLElement | null>(null);
  const lockedRef = useRef(false);
  const labelRef = useRef("");
  const [locked, setLocked] = useState(false);
  const [label, setLabel] = useState("");

  // Hide the OS cursor for the whole HUD — reticle is the only pointer.
  useEffect(() => {
    document.documentElement.classList.add(HUD_CURSOR_CLASS);
    return () => {
      document.documentElement.classList.remove(HUD_CURSOR_CLASS);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let mx = 0;
    let my = 0;
    let pending = false;

    const paint = () => {
      pending = false;
      raf = 0;
      const node = ref.current;
      if (!node) return;

      const target = findLockTarget(mx, my, stickyRef.current);
      stickyRef.current = target;

      if (target) {
        const r = target.getBoundingClientRect();
        const w = r.width + FRAME_PAD * 2;
        const h = r.height + FRAME_PAD * 2;
        const x = r.left - FRAME_PAD;
        const y = r.top - FRAME_PAD;
        node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        node.style.width = `${w}px`;
        node.style.height = `${h}px`;

        if (!lockedRef.current) {
          lockedRef.current = true;
          setLocked(true);
        }
        const lbl = targetLabel(target);
        if (lbl !== labelRef.current) {
          labelRef.current = lbl;
          setLabel(lbl);
        }
      } else {
        node.style.transform = `translate3d(${mx - FREE_SIZE / 2}px, ${my - FREE_SIZE / 2}px, 0)`;
        node.style.width = `${FREE_SIZE}px`;
        node.style.height = `${FREE_SIZE}px`;

        if (lockedRef.current) {
          lockedRef.current = false;
          setLocked(false);
        }
        if (labelRef.current) {
          labelRef.current = "";
          setLabel("");
        }
      }
    };

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(paint);
    };

    // If the reticle is framing a control, that control receives the click
    // even when the OS pointer is outside its box (magnetic lock).
    const onClickCapture = (e: MouseEvent) => {
      // Never steal clicks while a floating tile is being dragged / carried.
      if (document.body.dataset.jarvisDragging === "1") return;
      const target = stickyRef.current;
      if (!target || !lockedRef.current) return;
      if (!document.contains(target)) return;
      const src = e.target as Node | null;
      if (src && target.contains(src)) return; // already hitting the locked control
      e.preventDefault();
      e.stopImmediatePropagation();
      activateLocked(target);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("click", onClickCapture, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const color = locked ? "border-jarvis-aqua/95" : "border-jarvis-cyan/45";

  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 z-[100] pointer-events-none will-change-transform"
      style={{
        width: FREE_SIZE,
        height: FREE_SIZE,
        transition:
          "width 140ms cubic-bezier(0.16,1,0.3,1), height 140ms cubic-bezier(0.16,1,0.3,1), transform 90ms cubic-bezier(0.16,1,0.3,1)",
        filter: locked
          ? "drop-shadow(0 0 10px rgba(165,243,252,0.6))"
          : "drop-shadow(0 0 6px rgba(125,211,252,0.35))",
      }}
    >
      <div className={`absolute top-0 left-0 w-3 h-3 border-t-[1.5px] border-l-[1.5px] rounded-tl-md ${color} transition-[border-color] duration-150`} />
      <div className={`absolute top-0 right-0 w-3 h-3 border-t-[1.5px] border-r-[1.5px] rounded-tr-md ${color} transition-[border-color] duration-150`} />
      <div className={`absolute bottom-0 left-0 w-3 h-3 border-b-[1.5px] border-l-[1.5px] rounded-bl-md ${color} transition-[border-color] duration-150`} />
      <div className={`absolute bottom-0 right-0 w-3 h-3 border-b-[1.5px] border-r-[1.5px] rounded-br-md ${color} transition-[border-color] duration-150`} />
      <div
        className={`absolute inset-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full ${
          locked ? "bg-jarvis-aqua shadow-[0_0_6px_rgba(165,243,252,0.9)]" : "bg-jarvis-cyan/70"
        }`}
      />
      {locked && label && (
        <div className="absolute -top-5 left-full ml-2 whitespace-nowrap glass-chip text-jarvis-aqua">
          {label.toUpperCase()}
        </div>
      )}
    </div>
  );
}
