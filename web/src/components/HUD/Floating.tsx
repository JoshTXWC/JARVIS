/**
 * FLOATING — draggable + resizable panel wrapper.
 * Press-and-drag anywhere that isn't a control (or use the top handle).
 * Release over the top icon dock to put the tile back in the menu.
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
  /** Size height to content; hides the resize handle. */
  autoHeight?: boolean;
  /** Lock width (number or defaultBox.w) and hide resize. Kept across reloads. */
  fixedWidth?: number | true;
  /** Hide resize handle without changing drag. */
  noResize?: boolean;
  /** @deprecated — tiles no longer show X; docking replaces removal */
  removable?: boolean;
  overflowVisible?: boolean;
}

const STORAGE_PREFIX = "jarvis.floating.v2.";
const ANCHOR_PX = 96;
const DRAG_THRESHOLD_PX = 6;
/** Press-drag / double-click grab ignores these — real controls keep their clicks. */
const NO_GRAB_SEL =
  'button, a, input, textarea, select, label, [role="button"], [data-no-drag], [contenteditable="true"], .soft-field';

function setDraggingFlag(on: boolean) {
  try {
    if (on) document.body.dataset.jarvisDragging = "1";
    else delete document.body.dataset.jarvisDragging;
  } catch { /* noop */ }
}

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
  fixedWidth,
  noResize = false,
  overflowVisible = false,
}: Props) {
  const lockedW = fixedWidth === true ? defaultBox.w : typeof fixedWidth === "number" ? fixedWidth : null;
  const resizeEnabled = !locked && !autoHeight && !noResize && lockedW == null;

  const [saved, setSaved] = useState<SavedBox>(() => {
    const box = loadBox(id, defaultBox);
    if (lockedW != null) return { ...box, w: lockedW };
    return box;
  });
  const [vp, setVp] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1600,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  }));
  const [transient, setTransient] = useState<Box | null>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [docking, setDocking] = useState(false);
  /** Sticky grab from double-click — tile follows pointer until click/Esc. */
  const [carrying, setCarrying] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; orig: Box } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; orig: Box } | null>(null);
  const carryRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const layoutEdit = useStore((s) => s.layoutEdit);
  const dockPanel = useStore((s) => s.dockPanel);
  const setDockHot = useStore((s) => s.setDockHot);
  const canDock = isDockable(id);

  // Keep locked width sticky (overrides stale localStorage sizes).
  useEffect(() => {
    if (lockedW == null) return;
    setSaved((b) => (b.w === lockedW ? b : { ...b, w: lockedW }));
    setTransient((t) => (t && t.w !== lockedW ? { ...t, w: lockedW } : t));
  }, [lockedW]);

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
    const base = transient ?? computeDisplay(saved, vp.w, vp.h);
    if (lockedW == null) return base;
    return { ...base, w: lockedW };
  }, [saved, vp, transient, lockedW]);

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

  // Unified Hands — fist drag + two-hand scale + dock-on-release.
  useEffect(() => {
    const onMove = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id?: string;
        dx?: number;
        dy?: number;
        x?: number;
        y?: number;
      };
      if (!detail || detail.id !== id) return;
      if (locked || docking) return;
      const dx = detail.dx || 0;
      const dy = detail.dy || 0;
      setFocused(true);
      setDragging(true);
      setTransient((cur) => {
        const base = cur ?? display;
        return clampBox({ ...base, x: base.x + dx, y: base.y + dy });
      });
      if (canDock && typeof detail.x === "number" && typeof detail.y === "number") {
        setDockHot(inDockZone(detail.y, detail.x));
      }
    };
    const onScale = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id?: string;
        factor?: number;
        baseW?: number;
        baseH?: number;
      };
      if (!detail || detail.id !== id) return;
      if (locked || docking || noResize || autoHeight || lockedW != null) return;
      const factor = detail.factor ?? 1;
      const baseW = detail.baseW ?? display.w;
      const baseH = detail.baseH ?? display.h;
      setFocused(true);
      setDragging(true);
      setTransient((cur) => {
        const base = cur ?? display;
        const cx = base.x + base.w / 2;
        const cy = base.y + base.h / 2;
        const nw = Math.max(minW, baseW * factor);
        const nh = Math.max(minH, baseH * factor);
        return clampBox({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
      });
    };
    const onRelease = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id?: string; x?: number; y?: number };
      if (!detail || detail.id !== id) return;
      setDragging(false);
      if (
        canDock &&
        typeof detail.x === "number" &&
        typeof detail.y === "number" &&
        inDockZone(detail.y, detail.x)
      ) {
        useStore.getState().armDockDropLock(800);
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
    };
    window.addEventListener("jarvis:gesture-move", onMove);
    window.addEventListener("jarvis:gesture-scale", onScale);
    window.addEventListener("jarvis:gesture-release", onRelease);
    return () => {
      window.removeEventListener("jarvis:gesture-move", onMove);
      window.removeEventListener("jarvis:gesture-scale", onScale);
      window.removeEventListener("jarvis:gesture-release", onRelease);
    };
  }, [
    id,
    locked,
    docking,
    display,
    noResize,
    autoHeight,
    lockedW,
    minW,
    minH,
    canDock,
    setDockHot,
    startDockAnimation,
  ]);

  const applyDragPosition = useCallback((clientX: number, clientY: number, orig: Box, startX: number, startY: number) => {
    const next = {
      ...orig,
      x: orig.x + (clientX - startX),
      y: orig.y + (clientY - startY),
    };
    const hot = canDock && inDockZone(clientY, clientX);
    setDockHot(hot);
    setTransient(hot ? next : clampBox(next));
  }, [canDock, setDockHot]);

  const commitDrag = useCallback((clientX: number, clientY: number) => {
    setDragging(false);
    setDraggingFlag(false);
    dragRef.current = null;
    if (canDock && inDockZone(clientY, clientX)) {
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

  const dropCarry = useCallback((clientX?: number, clientY?: number) => {
    carryRef.current = null;
    setCarrying(false);
    setDragging(false);
    setDraggingFlag(false);
    if (
      canDock &&
      typeof clientX === "number" &&
      typeof clientY === "number" &&
      inDockZone(clientY, clientX)
    ) {
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

  // Top handle — immediate drag.
  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    if (locked || docking || carrying) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, orig: { ...display } };
    setTransient({ ...display });
    setFocused(true);
    setDragging(true);
    setDraggingFlag(true);
  }, [locked, docking, carrying, display]);

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    applyDragPosition(
      e.clientX,
      e.clientY,
      dragRef.current.orig,
      dragRef.current.startX,
      dragRef.current.startY,
    );
  }, [applyDragPosition]);

  const onHandlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    commitDrag(e.clientX, e.clientY);
  }, [commitDrag]);

  // Body press-and-drag (threshold) + double-click sticky carry.
  const pendingDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    orig: Box;
    armed: boolean;
  } | null>(null);

  const onBodyPointerDown = useCallback((e: React.PointerEvent) => {
    if (locked || docking || carrying || dragging) return;
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest(NO_GRAB_SEL)) return;
    // Don't steal events from the dedicated handle (it has its own listeners).
    if (t?.closest("[data-drag-handle]")) return;
    pendingDrag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...display },
      armed: false,
    };
    setFocused(true);
  }, [locked, docking, carrying, dragging, display]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pend = pendingDrag.current;
      if (pend && e.pointerId === pend.pointerId && !pend.armed) {
        const dist = Math.hypot(e.clientX - pend.startX, e.clientY - pend.startY);
        if (dist >= DRAG_THRESHOLD_PX) {
          pend.armed = true;
          dragRef.current = { startX: pend.startX, startY: pend.startY, orig: pend.orig };
          setTransient({ ...pend.orig });
          setDragging(true);
          setDraggingFlag(true);
        }
      }
      if (!dragRef.current || carrying) return;
      if (pend && e.pointerId !== pend.pointerId) return;
      applyDragPosition(
        e.clientX,
        e.clientY,
        dragRef.current.orig,
        dragRef.current.startX,
        dragRef.current.startY,
      );
    };

    const onUp = (e: PointerEvent) => {
      const pend = pendingDrag.current;
      if (pend && e.pointerId === pend.pointerId) {
        const wasArmed = pend.armed;
        pendingDrag.current = null;
        if (wasArmed && dragRef.current) {
          commitDrag(e.clientX, e.clientY);
          return;
        }
      }
      if (dragRef.current && !carrying) {
        // Handle-driven drag ended via window (pointer capture lost).
        commitDrag(e.clientX, e.clientY);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyDragPosition, commitDrag, carrying]);

  const onTileDoubleClick = useCallback((e: React.MouseEvent) => {
    if (locked || docking || carrying || dragging) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest(NO_GRAB_SEL)) return;
    e.preventDefault();
    e.stopPropagation();
    pendingDrag.current = null;
    carryRef.current = {
      offsetX: e.clientX - display.x,
      offsetY: e.clientY - display.y,
    };
    setTransient({ ...display });
    setFocused(true);
    setDragging(true);
    setCarrying(true);
    setDraggingFlag(true);
  }, [locked, docking, carrying, dragging, display]);

  // Sticky carry: follow pointer; click or Esc to place (dock if over menu).
  useEffect(() => {
    if (!carrying) return;

    const onMove = (e: PointerEvent) => {
      const grab = carryRef.current;
      if (!grab) return;
      const next = {
        x: e.clientX - grab.offsetX,
        y: e.clientY - grab.offsetY,
        w: display.w,
        h: display.h,
      };
      const hot = canDock && inDockZone(e.clientY, e.clientX);
      setDockHot(hot);
      setTransient(hot ? next : clampBox(next));
    };

    const onDown = (e: PointerEvent) => {
      if (e.detail >= 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dropCarry(e.clientX, e.clientY);
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dropCarry();
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [carrying, canDock, display.w, display.h, dropCarry, setDockHot]);

  useEffect(() => () => setDraggingFlag(false), []);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    if (!resizeEnabled || docking) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, orig: { ...display } };
    setTransient({ ...display });
    setFocused(true);
  }, [resizeEnabled, docking, display]);

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
      onPointerDown={onBodyPointerDown}
      onDoubleClick={onTileDoubleClick}
      onMouseEnter={() => setFocused(true)}
      onMouseLeave={() => { if (!dragging && !carrying) setFocused(false); }}
      title={
        carrying
          ? "Click to place · drop on top menu to dock · Esc to cancel"
          : canDock
            ? "Drag to move · drop on top menu to dock"
            : "Drag to move"
      }
      className={`animate-boot_in fixed pointer-events-auto ${dragging || carrying ? "select-none" : ""} ${layoutEdit ? "ring-1 ring-jarvis-cyan/20" : ""} ${carrying ? "ring-1 ring-jarvis-aqua/50" : ""}`}
      style={{
        left: display.x,
        top: display.y,
        width: display.w,
        height: autoHeight ? undefined : display.h,
        zIndex: focused || dragging || docking || carrying ? z + 5 : z,
        willChange: docking ? "transform, opacity" : undefined,
        opacity: carrying ? 0.92 : undefined,
        transition: carrying ? "opacity 120ms ease" : undefined,
      }}
    >
      {!locked && !docking && (
        <div
          data-drag-handle
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          title={canDock ? "Drag · drop on top menu to dock" : "Drag"}
          className="absolute top-0 left-0 right-0 h-7 z-30 cursor-grab active:cursor-grabbing"
          style={{
            touchAction: "none",
            background: dragging || carrying
              ? "linear-gradient(180deg, rgba(125,211,252,0.18), transparent)"
              : "linear-gradient(180deg, rgba(125,211,252,0.08), transparent)",
          }}
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

      {resizeEnabled && !docking && (
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
