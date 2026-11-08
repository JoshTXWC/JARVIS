/**
 * FLOATING — draggable + resizable panel wrapper.
 * Drag the top strip. Release in the top icon-dock zone to animate the
 * tile back into the centered menu (dockable panels only).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collidesAnything,
  findSlot,
  release as releaseSlot,
  update as updateSlot,
} from "../../lib/layoutBroker";
import { clampBox, contentBounds, inDockZone } from "../../lib/contentBounds";
import { isDockable } from "../../lib/dockCatalog";
import { useStore } from "../../lib/store";

export interface Box { x: number; y: number; w: number; h: number }
interface SavedBox extends Box { vw?: number; vh?: number }

interface Props {
  id: string;
  defaultBox: Box;
  minW?: number;
  minH?: number;
  children: React.ReactNode;
  locked?: boolean;
  z?: number;
  autoHeight?: boolean;
  /** @deprecated — tiles no longer show X; docking replaces removal */
  removable?: boolean;
  overflowVisible?: boolean;
}

const STORAGE_PREFIX = "jarvis.floating.v2.";
const ANCHOR_PX = 96;

function loadStoredBox(id: string): SavedBox | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (
      typeof b?.x === "number" &&
      typeof b?.y === "number" &&
      typeof b?.w === "number" &&
      typeof b?.h === "number"
    ) {
      return b;
    }
  } catch { /* ignore */ }
  return null;
}

function loadBox(id: string, fallback: Box): SavedBox {
  const stored = loadStoredBox(id);
  const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  if (stored) {
    const display = computeDisplay(stored, vw, vh);
    if (!collidesAnything(id, display)) {
      updateSlot(id, display);
      return { ...stored, ...display, vw, vh };
    }
  }
  const slot = findSlot(id, stored ?? fallback, vw, vh);
  const clamped = clampBox(slot, vw, vh);
  updateSlot(id, clamped);
  return { ...clamped, vw, vh };
}

function saveBox(id: string, box: Box) {
  const record: SavedBox = {
    ...box,
    vw: typeof window !== "undefined" ? window.innerWidth : undefined,
    vh: typeof window !== "undefined" ? window.innerHeight : undefined,
  };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(record)); } catch { /* ignore */ }
}

export function resetAllLayouts() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX) || k.startsWith("jarvis.floating.v1."))
      .forEach((k) => localStorage.removeItem(k));
    try {
      const raw = localStorage.getItem("jarvis.store.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.state) {
          parsed.state.dockedPanels = parsed.state.dockedPanels || [];
          localStorage.setItem("jarvis.store.v1", JSON.stringify(parsed));
        }
      }
    } catch { /* ignore */ }
    window.location.reload();
  } catch { /* ignore */ }
}

function computeDisplay(saved: SavedBox, vw: number, vh: number): Box {
  const bounds = contentBounds(vw, vh);
  const maxW = Math.max(80, bounds.right - bounds.left);
  const maxH = Math.max(60, bounds.bottom - bounds.top);
  const w = Math.min(saved.w, maxW);
  const h = Math.min(saved.h, maxH);

  if (!saved.vw || !saved.vh) {
    return clampBox({ x: saved.x, y: saved.y, w, h }, vw, vh);
  }

  const rightGap = saved.vw - (saved.x + saved.w);
  const centerOff = (saved.x + saved.w / 2) - saved.vw / 2;
  let x = saved.x;
  if (rightGap >= 0 && rightGap <= ANCHOR_PX && saved.x > ANCHOR_PX) {
    x = vw - w - rightGap;
  } else if (Math.abs(centerOff) <= ANCHOR_PX && saved.x > ANCHOR_PX) {
    x = vw / 2 - w / 2 + centerOff;
  }

  const bottomGap = saved.vh - (saved.y + saved.h);
  let y = saved.y;
  if (bottomGap >= 0 && bottomGap <= ANCHOR_PX && saved.y > ANCHOR_PX) {
    y = vh - h - bottomGap;
  }

  return clampBox({ x, y, w, h }, vw, vh);
}

function dockTargetRect(): DOMRect | null {
  const el = document.getElementById("jarvis-icon-dock");
  return el ? el.getBoundingClientRect() : null;
}

export default function Floating({
  id,
  defaultBox,
  minW = 240,
  minH = 120,
  children,
  locked = false,
  z = 20,
  autoHeight = false,
  overflowVisible = false,
}: Props) {
  const [saved, setSaved] = useState<SavedBox>(() => loadBox(id, defaultBox));
  const [vp, setVp] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1600,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  }));
  const [transient, setTransient] = useState<Box | null>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [docking, setDocking] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; orig: Box } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; orig: Box } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const layoutEdit = useStore((s) => s.layoutEdit);
  const dockPanel = useStore((s) => s.dockPanel);
  const setDockHot = useStore((s) => s.setDockHot);
  const canDock = isDockable(id);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      setVp({ w: window.innerWidth, h: window.innerHeight });
    };
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const flush = () => saveBox(id, transient ?? saved);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [id, saved, transient]);

  useEffect(() => {
    if (!autoHeight || !contentRef.current) return;
    const el = contentRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) {
        const h = Math.ceil(ent.contentRect.height);
        if (h > 0) {
          setSaved((b) => {
            if (Math.abs(b.h - h) < 2) return b;
            return { ...clampBox({ ...b, h }, vp.w, vp.h), vw: vp.w, vh: vp.h };
          });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [autoHeight, vp.w, vp.h]);

  useEffect(() => {
    saveBox(id, saved);
  }, [id, saved]);

  const display = useMemo(() => {
    if (transient) return transient;
    return computeDisplay(saved, vp.w, vp.h);
  }, [saved, vp, transient]);

  useEffect(() => {
    updateSlot(id, display);
  }, [id, display.x, display.y, display.w, display.h]);

  useEffect(() => () => releaseSlot(id), [id]);

  const finishDock = useCallback(() => {
    dockPanel(id);
    setDockHot(false);
  }, [dockPanel, id, setDockHot]);

  const startDockAnimation = useCallback(() => {
    if (!canDock || docking) return;
    setDocking(true);
    setDockHot(true);
    const dock = dockTargetRect();
    const node = rootRef.current;
    if (node && dock) {
      const cx = display.x + display.w / 2;
      const cy = display.y + display.h / 2;
      const tx = dock.left + dock.width / 2 - cx;
      const ty = dock.top + dock.height / 2 - cy;
      node.style.transition = "transform 280ms cubic-bezier(0.16,1,0.3,1), opacity 240ms ease";
      node.style.transformOrigin = "center center";
      node.style.transform = `translate(${tx}px, ${ty}px) scale(0.18)`;
      node.style.opacity = "0";
      window.setTimeout(finishDock, 290);
    } else {
      finishDock();
    }
  }, [canDock, docking, display, finishDock, setDockHot]);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (locked || docking) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("button, a, input, textarea, select, [data-no-drag]")) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, orig: { ...display } };
    setTransient({ ...display });
    setFocused(true);
    setDragging(true);
  }, [locked, docking, display]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // Allow free drag into the dock zone (don't clamp Y while dragging up).
    const next = {
      ...dragRef.current.orig,
      x: dragRef.current.orig.x + dx,
      y: dragRef.current.orig.y + dy,
    };
    const hot = canDock && inDockZone(e.clientY);
    setDockHot(hot);
    if (hot) {
      setTransient(next);
    } else {
      setTransient(clampBox(next));
    }
  }, [canDock, setDockHot]);

  const onDragEnd = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);

    if (canDock && inDockZone(e.clientY)) {
      startDockAnimation();
      return;
    }

    setDockHot(false);
    setTransient((t) => {
      if (t) {
        const next = clampBox(t);
        setSaved({ ...next, vw: window.innerWidth, vh: window.innerHeight });
      }
      return null;
    });
  }, [canDock, setDockHot, startDockAnimation]);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    if (locked || docking) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, orig: { ...display } };
    setTransient({ ...display });
    setFocused(true);
  }, [locked, docking, display]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startX;
    const dy = e.clientY - resizeRef.current.startY;
    const bounds = contentBounds();
    const next = {
      x: resizeRef.current.orig.x,
      y: resizeRef.current.orig.y,
      w: Math.max(minW, resizeRef.current.orig.w + dx),
      h: Math.max(minH, resizeRef.current.orig.h + dy),
    };
    next.w = Math.min(next.w, bounds.right - next.x);
    next.h = Math.min(next.h, bounds.bottom - next.y);
    setTransient(clampBox(next));
  }, [minW, minH]);

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    resizeRef.current = null;
    setTransient((t) => {
      if (t) {
        const next = clampBox(t);
        setSaved({ ...next, vw: window.innerWidth, vh: window.innerHeight });
      }
      return null;
    });
  }, []);

  return (
    <div
      ref={rootRef}
      data-floating-id={id}
      onPointerDown={() => setFocused(true)}
      onMouseEnter={() => setFocused(true)}
      onMouseLeave={() => { if (!dragging) setFocused(false); }}
      className={`animate-boot_in fixed pointer-events-auto ${dragging ? "select-none" : ""} ${layoutEdit ? "ring-1 ring-jarvis-cyan/20" : ""}`}
      style={{
        left: display.x,
        top: display.y,
        width: display.w,
        height: autoHeight ? undefined : display.h,
        zIndex: focused || dragging || docking ? z + 5 : z,
        willChange: docking ? "transform, opacity" : undefined,
      }}
    >
      {!locked && !docking && (
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          title={canDock ? "Drag · drop on top menu to dock" : "Drag"}
          className="absolute top-0 left-0 right-0 h-9 z-30 cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
        />
      )}

      <div
        ref={contentRef}
        style={{
          width: "100%",
          height: autoHeight ? "auto" : "100%",
          display: "flex",
          flexDirection: "column",
          overflow: overflowVisible ? "visible" : "hidden",
        }}
      >
        {children}
      </div>

      {!locked && !autoHeight && !docking && (
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          title="Resize"
          data-no-drag
          className="absolute bottom-0 right-0 w-5 h-5 z-30 cursor-nwse-resize"
          style={{ touchAction: "none" }}
        >
          <div
            className="absolute bottom-1.5 right-1.5 text-jarvis-ice/40 transition-opacity"
            style={{ opacity: focused || dragging || layoutEdit ? 0.7 : 0.2 }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M9 1 L1 9 M9 5 L5 9 M9 9 L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
