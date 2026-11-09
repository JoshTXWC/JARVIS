/* JARVIS desktop hands overlay — skeleton + cyan tip cursor with pinch/drag phases. */
(function () {
  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
  ];
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const state = {
    viz: "skeleton",
    opacity: 0.9,
    mode: "—",
    gesture: "waiting",
    paused: false,
    tracking: false,
    hands: [],
    cursor: null,
    videoW: 1280,
    videoH: 720,
    collapsed: false,
    lastFrameAt: 0,
    pulseT: 0,
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  /**
   * Skeleton = camera space → mirrored object-cover over the overlay window.
   * Cursor = calibrated desktop UV (separate transform — do not reuse mapPt).
   */
  function mapSkeletonPt(p) {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const videoW = state.videoW || 1280;
    const videoH = state.videoH || 720;
    const scale = Math.max(viewW / videoW, viewH / videoH);
    const dispW = videoW * scale;
    const dispH = videoH * scale;
    const offsetX = (viewW - dispW) / 2;
    const offsetY = (viewH - dispH) / 2;
    const nx = 1 - Math.min(1, Math.max(0, p[0]));
    const ny = Math.min(1, Math.max(0, p[1]));
    return { x: offsetX + nx * dispW, y: offsetY + ny * dispH };
  }

  function cursorPx(c) {
    if (!c) return null;
    // Desktop UV already accounts for virtual-screen origin; overlay spans virtual bounds.
    return {
      x: c.u * window.innerWidth,
      y: c.v * window.innerHeight,
      phase: c.phase || "point",
      approach: typeof c.approach === "number" ? c.approach : 0,
      hold: typeof c.hold === "number" ? c.hold : 0,
      locked: !!c.locked,
    };
  }

  function drawCursor(c) {
    if (!c) return;
    const phase = c.phase;
    const pulse = 0.5 + 0.5 * Math.sin(state.pulseT * 0.008);
    const approach = Math.max(0, Math.min(1, c.approach));
    const hold = Math.max(0, Math.min(1, c.hold));

    // Outer ring radius contracts as pinch approaches
    const baseRing = 16;
    const ringR = phase === "approach" || phase === "locked" || phase === "drag_ready"
      ? baseRing - approach * 8
      : phase === "dragging"
        ? 14
        : 13;

    // Hold progress arc (drag ready)
    if (phase === "locked" || phase === "drag_ready") {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(34,211,238,0.25)";
      ctx.lineWidth = 2.5;
      ctx.arc(c.x, c.y, ringR + 4, 0, Math.PI * 2);
      ctx.stroke();
      if (hold > 0.02) {
        ctx.beginPath();
        ctx.strokeStyle = phase === "drag_ready"
          ? "rgba(251,191,36,0.95)"
          : "rgba(34,211,238,0.9)";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.arc(c.x, c.y, ringR + 4, -Math.PI / 2, -Math.PI / 2 + hold * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Approach / lock ring
    if (phase === "approach" || phase === "locked" || phase === "drag_ready" || phase === "releasing") {
      ctx.beginPath();
      ctx.strokeStyle = phase === "locked" || phase === "drag_ready"
        ? "rgba(34,211,238," + (0.55 + pulse * 0.35) + ")"
        : "rgba(34,211,238,0.55)";
      ctx.lineWidth = 1.8;
      ctx.arc(c.x, c.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (phase === "dragging") {
      // Grab indicator — rounded square + crosshair
      const s = 11;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.fillStyle = "rgba(251,191,36,0.22)";
      ctx.strokeStyle = "rgba(251,191,36,0.95)";
      ctx.lineWidth = 2;
      if (ctx.roundRect) {
        ctx.roundRect(-s, -s, s * 2, s * 2, 3);
      } else {
        ctx.rect(-s, -s, s * 2, s * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(251,191,36,0.8)";
      ctx.lineWidth = 1.5;
      ctx.moveTo(c.x - 7, c.y);
      ctx.lineTo(c.x + 7, c.y);
      ctx.moveTo(c.x, c.y - 7);
      ctx.lineTo(c.x, c.y + 7);
      ctx.stroke();
      return;
    }

    if (phase === "fist") {
      ctx.beginPath();
      ctx.fillStyle = "rgba(251,191,36,0.9)";
      ctx.shadowColor = "rgba(251,191,36,0.8)";
      ctx.shadowBlur = 10;
      ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }

    // Cyan fingertip cursor (point / approach / locked / releasing / scroll)
    const core = phase === "locked" || phase === "drag_ready" ? 5.5 + pulse * 1.2 : 5;
    ctx.beginPath();
    ctx.fillStyle = "rgba(34,211,238,0.22)";
    ctx.arc(c.x, c.y, core + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#22d3ee";
    ctx.shadowColor = "rgba(34,211,238,0.95)";
    ctx.shadowBlur = phase === "locked" ? 14 : 10;
    ctx.arc(c.x, c.y, core, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.arc(c.x, c.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (state.viz === "hidden") return;
    ctx.globalAlpha = state.opacity;

    if (state.viz === "skeleton" && state.hands.length) {
      for (const hand of state.hands) {
        const pts = hand.map(mapSkeletonPt);
        ctx.strokeStyle = "rgba(34,211,238,0.5)";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        for (const [a, b] of CONNECTIONS) {
          const A = pts[a];
          const B = pts[b];
          if (!A || !B) continue;
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
        }
        for (let i = 0; i < pts.length; i++) {
          // Landmark 8 still drawn for skeleton fidelity; OS cursor uses separate UV.
          const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
          ctx.beginPath();
          ctx.fillStyle = tip ? "rgba(224,242,254,0.85)" : "rgba(125,211,252,0.7)";
          ctx.arc(pts[i].x, pts[i].y, tip ? 4 : 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Calibrated desktop cursor (may intentionally differ from skeleton tip).
    var c = cursorPx(state.cursor);
    if (!c && state.viz === "minimal" && state.hands.length && state.hands[0] && state.hands[0][8]) {
      var tip = mapSkeletonPt(state.hands[0][8]);
      c = { x: tip.x, y: tip.y, phase: "point", approach: 0, hold: 0 };
    }
    if (c && state.tracking && (state.viz === "skeleton" || state.viz === "minimal")) {
      drawCursor(c);
    }

    ctx.globalAlpha = 1;
  }

  function syncChip() {
    var age = Date.now() - state.lastFrameAt;
    var label = state.gesture || "waiting";
    if (state.paused) label = "paused";
    else if (!state.lastFrameAt) label = "waiting";
    else if (age > 1500) label = "no signal";
    else if (!state.tracking) label = "seeking";

    var modeLabel = String(state.mode || "—");
    if (modeLabel === "precision" || modeLabel === "spatial") modeLabel = "control";
    document.getElementById("mode").textContent = modeLabel.toUpperCase();
    document.getElementById("gesture").textContent = label;
    document.getElementById("cam").classList.toggle("off", !state.tracking);
    document.getElementById("pauseBtn").textContent = state.paused ? "Resume" : "Pause";
    document.getElementById("chip").classList.toggle("hidden", state.collapsed);
    document.getElementById("collapsed").classList.toggle("show", state.collapsed);
  }

  function onFrame(frame) {
    state.lastFrameAt = Date.now();
    state.hands = (frame && frame.hands) || [];
    state.cursor = (frame && frame.cursor) || null;
    if (frame && frame.videoW) state.videoW = frame.videoW;
    if (frame && frame.videoH) state.videoH = frame.videoH;
    state.tracking = !(frame && frame.lost) && (state.hands.length > 0 || !!state.cursor);
    if (frame && frame.poses && frame.poses.length) state.gesture = frame.poses[0];
    else state.gesture = state.tracking ? "track" : "seeking";
    syncChip();
    draw();
  }

  function onMeta(meta) {
    if (!meta) return;
    if (meta.mode) state.mode = meta.mode;
    if (meta.viz_mode) state.viz = meta.viz_mode;
    if (typeof meta.overlay_opacity === "number") state.opacity = meta.overlay_opacity;
    if (typeof meta.paused === "boolean") state.paused = meta.paused;
    if (meta.gesture) state.gesture = meta.gesture;
    syncChip();
    draw();
  }

  function tickPulse(ts) {
    state.pulseT = ts;
    if (state.cursor && (state.cursor.phase === "locked" || state.cursor.phase === "drag_ready")) {
      draw();
    }
    requestAnimationFrame(tickPulse);
  }
  requestAnimationFrame(tickPulse);

  setInterval(syncChip, 400);

  if (window.jarvisOverlay) {
    window.jarvisOverlay.onFrame(onFrame);
    window.jarvisOverlay.onMeta(onMeta);
    document.getElementById("pauseBtn").onclick = function () {
      state.paused = !state.paused;
      window.jarvisOverlay.send("toggle-pause", { paused: state.paused });
      syncChip();
    };
    document.getElementById("modeBtn").onclick = function () {
      window.jarvisOverlay.send("cycle-mode");
    };
    document.getElementById("hideBtn").onclick = function () {
      state.collapsed = true;
      syncChip();
    };
    document.getElementById("collapsed").onclick = function () {
      state.collapsed = false;
      syncChip();
    };
  } else {
    state.gesture = "no bridge";
    syncChip();
  }

  syncChip();
})();
