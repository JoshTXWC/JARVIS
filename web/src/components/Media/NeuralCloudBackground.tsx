/**
 * Full-viewport neural cloud — alternate world background.
 * Orbit-drag, scroll-zoom, click nodes. Uses live memory galaxy when present;
 * otherwise a procedural cloud so the mode always feels alive.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type GalaxyCluster, type GalaxyNode } from "../../lib/store";
import { wsClient } from "../../lib/ws";

interface PreparedNode extends GalaxyNode {
  px: number;
  py: number;
  pz: number;
  phase: number;
  size: number;
}

const PERSPECTIVE = 3.2;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 7.5;

export default function NeuralCloudBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const camRef = useRef({ x: 0.18, y: 0.35, vx: 0, vy: 0.0018, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number; on: boolean; moved: boolean }>({
    x: 0, y: 0, on: false, moved: false,
  });
  const hoverRef = useRef<{ sx: number; sy: number } | null>(null);
  const hoverNodeRef = useRef<PreparedNode | null>(null);
  const selectedRef = useRef<PreparedNode | null>(null);
  const hoverPosRef = useRef<{ sx: number; sy: number }>({ sx: 0, sy: 0 });
  const handsPinchRef = useRef(false);
  const handsZoomDistRef = useRef(0);
  const handsPanRef = useRef<{ x: number; y: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<PreparedNode | null>(null);
  const [selected, setSelected] = useState<PreparedNode | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [hud, setHud] = useState({ nodes: 0, clusters: 0 });

  const media = useStore((s) => s.media);
  const galaxyCard = media.find((m) => m.kind === "galaxy" && m.galaxy);

  const { prepared, edges, clusters } = useMemo(() => {
    const source = galaxyCard?.galaxy;
    const nodes = source?.nodes?.length
      ? source.nodes
      : proceduralNodes();
    const cls = source?.clusters?.length
      ? source.clusters
      : proceduralClusters(nodes);

    const seen: Record<string, number> = {};
    const preparedNodes: PreparedNode[] = nodes.map((n) => {
      const idx = (seen[n.category] = (seen[n.category] ?? -1) + 1);
      const seed = hashStr(n.id + idx);
      const r = 0.14 + ((seed & 0xff) / 255) * 0.38;
      const t = (((seed >>> 8) & 0xffff) / 0xffff) * Math.PI * 2;
      const p = (((seed >>> 16) & 0xff) / 255) * Math.PI;
      return {
        ...n,
        px: n.anchor[0] + Math.sin(p) * Math.cos(t) * r,
        py: n.anchor[1] + Math.cos(p) * r,
        pz: n.anchor[2] + Math.sin(p) * Math.sin(t) * r,
        phase: ((seed & 0xffff) / 0xffff) * Math.PI * 2,
        size: 1.2 + (((seed >>> 4) & 0x07) / 7) * 1.6,
      };
    });

    const groups: Record<string, number[]> = {};
    preparedNodes.forEach((n, i) => {
      (groups[n.category] ||= []).push(i);
    });
    const edgeList: [number, number][] = [];
    for (const list of Object.values(groups)) {
      for (let i = 0; i < list.length - 1; i++) edgeList.push([list[i], list[i + 1]]);
      // a few cross-links for denser “neural” feel
      for (let i = 0; i < list.length - 3; i += 3) {
        edgeList.push([list[i], list[i + 2]]);
      }
    }
    // light bridges between neighboring cluster anchors
    for (let i = 0; i < cls.length - 1; i++) {
      const a = preparedNodes.findIndex((n) => n.category === cls[i].name.toLowerCase() || n.category.toUpperCase() === cls[i].name);
      const b = preparedNodes.findIndex((n) => n.category === cls[i + 1].name.toLowerCase() || n.category.toUpperCase() === cls[i + 1].name);
      if (a >= 0 && b >= 0) edgeList.push([a, b]);
    }

    return { prepared: preparedNodes, edges: edgeList, clusters: cls };
  }, [galaxyCard]);

  useEffect(() => {
    setHud({ nodes: prepared.length, clusters: clusters.length });
  }, [prepared, clusters]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    let raf = 0;

    const resize = () => {
      const w = wrapRef.current?.clientWidth || window.innerWidth;
      const h = wrapRef.current?.clientHeight || window.innerHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);

    let t = 0;
    const project = (x: number, y: number, z: number) => {
      const cam = camRef.current;
      const cosY = Math.cos(cam.y);
      const sinY = Math.sin(cam.y);
      let rx = x * cosY + z * sinY;
      let rz = -x * sinY + z * cosY;
      const cosX = Math.cos(cam.x);
      const sinX = Math.sin(cam.x);
      let ry = y * cosX - rz * sinX;
      rz = y * sinX + rz * cosX;
      const w = c.clientWidth;
      const h = c.clientHeight;
      const scale = Math.min(w, h) * 0.38 * cam.zoom;
      const f = PERSPECTIVE / (PERSPECTIVE - rz);
      return {
        sx: w / 2 + rx * scale * f,
        sy: h / 2 + ry * scale * f,
        depth: rz,
        f,
      };
    };

    const tick = () => {
      t += 1;
      const cam = camRef.current;
      if (!dragRef.current.on) {
        cam.y += cam.vy;
        cam.x += cam.vx;
        cam.vx *= 0.96;
        cam.vy = cam.vy * 0.98 + 0.0018 * 0.02;
      }

      const w = c.clientWidth;
      const h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // deep void + soft cyan bloom
      const voidGrad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, Math.max(w, h) * 0.72);
      voidGrad.addColorStop(0, "rgba(8, 22, 42, 0.55)");
      voidGrad.addColorStop(0.55, "rgba(3, 8, 18, 0.35)");
      voidGrad.addColorStop(1, "rgba(2, 5, 12, 0.15)");
      ctx.fillStyle = voidGrad;
      ctx.fillRect(0, 0, w, h);

      const proj = prepared.map((n) => ({ n, ...project(n.px, n.py, n.pz) }));
      proj.sort((a, b) => a.depth - b.depth);

      ctx.lineWidth = 0.7;
      for (const [ai, bi] of edges) {
        const pa = proj.find((p) => p.n === prepared[ai]);
        const pb = proj.find((p) => p.n === prepared[bi]);
        if (!pa || !pb) continue;
        const alpha = Math.max(0.05, Math.min(0.5, (pa.depth + pb.depth) * 0.22 + 0.32));
        ctx.strokeStyle = withAlpha(pa.n.color, alpha * 0.55);
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
      }

      let hover: PreparedNode | null = null;
      let hoverSx = 0;
      let hoverSy = 0;
      const hx = hoverRef.current?.sx ?? null;
      const hy = hoverRef.current?.sy ?? null;
      const sel = selectedRef.current;

      for (const p of proj) {
        const twinkle = 0.72 + 0.28 * Math.sin(t * 0.035 + p.n.phase);
        const isSel = sel?.id === p.n.id;
        const sz = p.n.size * p.f * twinkle * (isSel ? 1.55 : 1);
        ctx.beginPath();
        ctx.fillStyle = withAlpha(p.n.color, Math.min(0.6, 0.18 + p.f * 0.14));
        ctx.arc(p.sx, p.sy, sz * (isSel ? 3.2 : 2.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = withAlpha(p.n.color, isSel ? 1 : 0.92);
        ctx.arc(p.sx, p.sy, sz, 0, Math.PI * 2);
        ctx.fill();
        if (isSel) {
          ctx.beginPath();
          ctx.strokeStyle = withAlpha(p.n.color, 0.85);
          ctx.lineWidth = 1.2;
          ctx.arc(p.sx, p.sy, sz * 3.8, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (hx !== null && hy !== null) {
          const dx = hx - p.sx;
          const dy = hy - p.sy;
          // Generous hit radius — easier finger / mouse targeting, especially zoomed in
          const hit = Math.max(18, sz * (4.8 + cam.zoom * 0.35));
          if (dx * dx + dy * dy < hit * hit) {
            hover = p.n;
            hoverSx = p.sx;
            hoverSy = p.sy;
          }
        }
      }

      // cluster labels at mid zoom+
      if (cam.zoom > 0.7) {
        ctx.font = "10px 'JetBrains Mono', monospace";
        for (const cl of clusters) {
          const lp = project(cl.anchor[0], cl.anchor[1], cl.anchor[2]);
          if (lp.depth < -0.75) continue;
          const op = Math.min(1, 0.25 + lp.f * 0.25) * Math.min(1, cam.zoom);
          ctx.fillStyle = withAlpha(cl.color, op);
          ctx.strokeStyle = "rgba(2,6,15,0.8)";
          ctx.lineWidth = 3;
          const label = `${cl.name} · ${cl.count}`;
          ctx.strokeText(label, lp.sx + 10, lp.sy - 10);
          ctx.fillText(label, lp.sx + 10, lp.sy - 10);
        }
      }

      hoverNodeRef.current = hover;
      if (hover !== hoverNode) setHoverNode(hover);
      if (hover) {
        hoverPosRef.current = { sx: hoverSx, sy: hoverSy };
        setPopupPos({ x: hoverSx, y: hoverSy });
      } else if (sel) {
        const sp = proj.find((p) => p.n.id === sel.id);
        if (sp) {
          hoverPosRef.current = { sx: sp.sx, sy: sp.sy };
          setPopupPos({ x: sp.sx, y: sp.sy });
        }
      } else {
        setPopupPos(null);
      }

      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, edges, clusters]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      dragRef.current = { x: e.clientX, y: e.clientY, on: true, moved: false };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      hoverRef.current = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
      if (!dragRef.current.on) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
      dragRef.current.x = e.clientX;
      dragRef.current.y = e.clientY;
      const cam = camRef.current;
      cam.y += dx * 0.0045;
      cam.x += dy * 0.0045;
      cam.x = Math.max(-Math.PI / 2 + 0.15, Math.min(Math.PI / 2 - 0.15, cam.x));
      cam.vx = dy * 0.0007;
      cam.vy = dx * 0.0007;
    };
    const onUp = (e: PointerEvent) => {
      const wasClick = dragRef.current.on && !dragRef.current.moved;
      dragRef.current.on = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (wasClick) {
        const node = hoverNodeRef.current;
        selectedRef.current = node;
        setSelected(node);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      // Stronger zoom response for quicker node approach
      const factor = Math.exp(-e.deltaY * 0.0028);
      cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));
    };
    const onLeave = () => {
      hoverRef.current = null;
      hoverNodeRef.current = null;
      setHoverNode(null);
    };

    const onHandsPointer = (ev: Event) => {
      const d = (ev as CustomEvent).detail as {
        x?: number;
        y?: number;
        pinch?: boolean;
        pinch2?: boolean;
        fist?: boolean;
        hands?: number;
        x2?: number;
        y2?: number;
      };
      const rect = el.getBoundingClientRect();
      if (d.x == null || d.y == null || d.x < 0) {
        hoverRef.current = null;
        handsPanRef.current = null;
        handsZoomDistRef.current = 0;
        return;
      }
      const sx = d.x - rect.left;
      const sy = d.y - rect.top;
      hoverRef.current = { sx, sy };

      const pinch = !!d.pinch;
      const pinch2 = !!d.pinch2;

      // Zoom / rotate ONLY while fingers are pinched.
      // Two pinched hands → zoom by separation; one pinched hand → orbit.
      if ((d.hands || 0) >= 2 && pinch && pinch2 && d.x2 != null && d.y2 != null) {
        const dist = Math.hypot(d.x2 - d.x, d.y2 - d.y);
        if (handsZoomDistRef.current > 1) {
          const ratio = dist / handsZoomDistRef.current;
          if (Math.abs(ratio - 1) > 0.01) {
            const cam = camRef.current;
            cam.zoom = Math.max(
              ZOOM_MIN,
              Math.min(ZOOM_MAX, cam.zoom * Math.pow(ratio, 1.35)),
            );
          }
        }
        handsZoomDistRef.current = dist;
        handsPanRef.current = null;
      } else {
        handsZoomDistRef.current = 0;
        if (pinch && !pinch2) {
          if (!handsPanRef.current) {
            handsPanRef.current = { x: d.x, y: d.y };
          } else {
            const dx = d.x - handsPanRef.current.x;
            const dy = d.y - handsPanRef.current.y;
            handsPanRef.current = { x: d.x, y: d.y };
            const cam = camRef.current;
            cam.y += dx * 0.0055;
            cam.x += dy * 0.0055;
            cam.x = Math.max(-Math.PI / 2 + 0.15, Math.min(Math.PI / 2 - 0.15, cam.x));
          }
        } else {
          handsPanRef.current = null;
        }
      }

      // Rising pinch edge still selects the hovered node (quick tap)
      if (pinch && !handsPinchRef.current) {
        const node = hoverNodeRef.current;
        selectedRef.current = node;
        setSelected(node);
      }
      handsPinchRef.current = pinch;
    };

    const onHandsClick = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { x?: number; y?: number };
      if (d.x == null || d.y == null) return;
      const rect = el.getBoundingClientRect();
      hoverRef.current = { sx: d.x - rect.left, sy: d.y - rect.top };
      // Selection resolved next frames via hoverNodeRef; pick immediately if known
      const node = hoverNodeRef.current;
      selectedRef.current = node;
      setSelected(node);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("jarvis:hands-pointer", onHandsPointer);
    window.addEventListener("jarvis:hands-click", onHandsClick);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("jarvis:hands-pointer", onHandsPointer);
      window.removeEventListener("jarvis:hands-click", onHandsClick);
    };
  }, []);

  const askAbout = () => {
    if (!selected) return;
    const q = `Tell me about this memory: [${selected.category}] ${selected.title}${
      selected.body ? ` — ${selected.body.slice(0, 160)}` : ""
    }`;
    wsClient.chat(q);
  };

  const syncMemory = () => {
    try {
      wsClient.chat("show my memory galaxy");
    } catch {
      /* offline */
    }
  };

  const live = Boolean(galaxyCard?.galaxy?.nodes?.length);

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[2] overflow-hidden"
      aria-label="Neural cloud background"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-grab active:cursor-grabbing"
      />

      <div className="absolute top-[72px] left-3 pointer-events-none text-mono text-[10px] tracking-[0.28em] text-jarvis-aqua/80 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-jarvis-aqua animate-pulse" />
        NEURAL CLOUD · {live ? "MEMORY" : "SYNTHETIC"}
      </div>
      <div className="absolute top-[72px] right-3 flex items-center gap-2">
        {!live && (
          <button
            type="button"
            onClick={syncMemory}
            className="pointer-events-auto text-mono text-[10px] tracking-[0.2em] uppercase text-jarvis-ice/85 px-2 py-0.5 border border-jarvis-aqua/40 bg-jarvis-ink/55 hover:bg-jarvis-cyan/10 transition-colors"
            title="Load live memory nodes into this cloud"
          >
            Sync memory
          </button>
        )}
        <div className="pointer-events-none text-mono text-[10px] tracking-widest text-jarvis-cyan/70 bg-jarvis-ink/50 px-2 py-0.5 border border-jarvis-aqua/30">
          {hud.nodes} NODES · {hud.clusters} CLUSTERS · PINCH DRAG/ZOOM
        </div>
      </div>

      {(hoverNode || selected) && popupPos && (
        <div
          className="absolute z-20 max-w-[280px] pointer-events-auto text-mono text-[11px] bg-jarvis-ink/92 border px-3 py-2 backdrop-blur-md"
          style={{
            left: Math.max(12, Math.min(popupPos.x + 14, (wrapRef.current?.clientWidth || 800) - 292)),
            top: Math.max(72, Math.min(popupPos.y - 12, (wrapRef.current?.clientHeight || 600) - 160)),
            borderColor: withAlpha((selected || hoverNode)!.color, 0.65),
            boxShadow: `0 0 18px ${withAlpha((selected || hoverNode)!.color, 0.28)}`,
            transform: "translateY(-100%)",
          }}
        >
          <div
            className="tracking-widest text-[9px] opacity-70 mb-0.5"
            style={{ color: (selected || hoverNode)!.color }}
          >
            {(selected || hoverNode)!.category.toUpperCase()}
          </div>
          <div className="text-jarvis-aqua">{(selected || hoverNode)!.title}</div>
          {(selected || hoverNode)!.body && (
            <div className="text-jarvis-cyan/70 mt-1 line-clamp-4 leading-relaxed">
              {(selected || hoverNode)!.body}
            </div>
          )}
          {selected && (
            <button
              type="button"
              onClick={askAbout}
              className="mt-2 text-[10px] tracking-[0.2em] uppercase text-jarvis-ice/90 px-2 py-1 border border-jarvis-aqua/40 hover:bg-jarvis-cyan/10 transition-colors"
            >
              Ask about this
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── procedural fallback cloud ── */
const PROC_COLORS = ["#22d3ee", "#67e8f9", "#a78bfa", "#7dd3fc", "#38bdf8", "#c4b5fd", "#fbbf24"];
const PROC_CATS = ["synapse", "circuit", "memory", "signal", "core", "link"];

function proceduralNodes(): GalaxyNode[] {
  const nodes: GalaxyNode[] = [];
  PROC_CATS.forEach((cat, ci) => {
    const anchor = proceduralAnchor(cat);
    const color = PROC_COLORS[ci % PROC_COLORS.length];
    const count = 14 + (hashStr(cat) % 10);
    for (let i = 0; i < count; i++) {
      const id = `${cat}-${i}`;
      nodes.push({
        id,
        category: cat,
        color,
        title: `${cat.toUpperCase()} · ${i + 1}`,
        body: "Synthetic neural node — live memory will replace this cloud.",
        anchor,
      });
    }
  });
  return nodes;
}

function proceduralClusters(nodes: GalaxyNode[]): GalaxyCluster[] {
  const map = new Map<string, GalaxyCluster>();
  for (const n of nodes) {
    const cur = map.get(n.category);
    if (cur) cur.count += 1;
    else {
      map.set(n.category, {
        name: n.category.toUpperCase(),
        color: n.color,
        count: 1,
        anchor: n.anchor,
      });
    }
  }
  return [...map.values()];
}

function proceduralAnchor(name: string): [number, number, number] {
  const h = hashStr(name);
  const a = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const b = (((h >>> 16) & 0xffff) / 0xffff) * Math.PI;
  const r = 0.55 + ((h >>> 8) & 0xff) / 255 * 0.3;
  return [
    Math.sin(b) * Math.cos(a) * r,
    Math.cos(b) * r * 0.85,
    Math.sin(b) * Math.sin(a) * r,
  ];
}

function withAlpha(hex: string, a: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${a})`;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
