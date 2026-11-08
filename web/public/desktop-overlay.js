/* JARVIS desktop hands overlay — landmark viz + control chip (no camera). */
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
    opacity: 0.85,
    mode: "hud",
    gesture: "idle",
    paused: false,
    tracking: false,
    hands: [],
    collapsed: false,
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function mapPt(p) {
    return { x: (1 - p[0]) * window.innerWidth, y: p[1] * window.innerHeight };
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (state.viz === "hidden" || !state.hands.length) return;
    ctx.globalAlpha = state.opacity;
    for (const hand of state.hands) {
      const pts = hand.map(mapPt);
      if (state.viz === "skeleton") {
        ctx.strokeStyle = "rgba(34,211,238,0.55)";
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
          const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
          ctx.beginPath();
          ctx.fillStyle = tip ? "rgba(224,242,254,0.95)" : "rgba(125,211,252,0.9)";
          ctx.arc(pts[i].x, pts[i].y, tip ? 4.5 : 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const tip = pts[8];
        if (!tip) continue;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(34,211,238,0.9)";
        ctx.fillStyle = "rgba(34,211,238,0.18)";
        ctx.lineWidth = 2;
        ctx.arc(tip.x, tip.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function syncChip() {
    document.getElementById("mode").textContent = String(state.mode || "hud").toUpperCase();
    document.getElementById("gesture").textContent = state.paused ? "paused" : (state.gesture || "idle");
    document.getElementById("cam").classList.toggle("off", !state.tracking);
    document.getElementById("pauseBtn").textContent = state.paused ? "Resume" : "Pause";
    document.getElementById("chip").classList.toggle("hidden", state.collapsed);
    document.getElementById("collapsed").classList.toggle("show", state.collapsed);
  }

  function onFrame(frame) {
    state.hands = (frame && frame.hands) || [];
    state.tracking = !(frame && frame.lost) && state.hands.length > 0;
    if (frame && frame.poses && frame.poses.length) state.gesture = frame.poses[0];
    else state.gesture = state.tracking ? "track" : "lost";
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
  }

  syncChip();
})();
