/**
 * J.A.R.V.I.S. — Electron shell.
 *
 * Background-resident: closing the window hides to the tray instead of
 * quitting. The renderer keeps running, so the mic and wake-word loop
 * survive across show/hide cycles. Single visual mode: 1600x1000 frameless
 * workstation HUD.
 *
 * Global hotkey CommandOrControl+Shift+Space toggles visibility. Wake-word
 * detection in the renderer ALSO opens the window (via IPC) so the user
 * can speak from anywhere.
 */
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");

const BACKEND_PORT = process.env.JARVIS_PORT ? parseInt(process.env.JARVIS_PORT, 10) : 7341;
const BACKEND_URL  = `http://127.0.0.1:${BACKEND_PORT}`;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TRAY_ICON_PATH = path.resolve(PROJECT_ROOT, "web", "public", "favicon.png");
const TRAY_ICON_FALLBACK_SVG = path.resolve(PROJECT_ROOT, "web", "public", "favicon.svg");

const FULL_W = 1600;
const FULL_H = 1000;

let mainWindow = null;
let overlayWindow = null;
let backend = null;
let tray = null;
let isQuiting = false;
let overlayWanted = false;

// ── backend lifecycle ─────────────────────────────────────────────────────

function pingBackend() {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/api/health`, { timeout: 800 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForBackend(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingBackend()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startBackend() {
  pingBackend().then((alive) => {
    if (alive) {
      console.log("[electron] backend already running, skipping spawn");
      return;
    }
    const venvPython = process.platform === "win32"
      ? path.join(PROJECT_ROOT, "venv", "Scripts", "python.exe")
      : path.join(PROJECT_ROOT, "venv", "bin", "python");
    console.log("[electron] spawning backend:", venvPython);
    // --no-browser: Electron IS the UI (loads BACKEND_URL in-window). Without
    // this the backend would also pop a separate browser tab on the web app.
    backend = spawn(venvPython, ["-m", "jarvis.main", "--port", String(BACKEND_PORT), "--no-browser"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: "inherit",
    });
    backend.on("exit", (code) => {
      console.log("[electron] backend exited", code);
      backend = null;
    });
    backend.on("error", (err) => {
      console.error("[electron] backend spawn error:", err);
    });
  });
}

// ── window helpers ────────────────────────────────────────────────────────

function pickTrayIcon() {
  // Prefer PNG if available, fall back to bundled SVG rendered at runtime.
  if (fs.existsSync(TRAY_ICON_PATH)) {
    const img = nativeImage.createFromPath(TRAY_ICON_PATH);
    if (!img.isEmpty()) return img.resize({ width: 18, height: 18 });
  }
  if (fs.existsSync(TRAY_ICON_FALLBACK_SVG)) {
    // Electron can't render SVG directly to a tray icon on Windows; fall
    // back to a tiny solid-cyan PNG generated at runtime if SVG is all
    // that's bundled. Caller still gets a visible tray entry.
    const buf = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR4nGMUEhJiYmBgYBgFo2AYAAAEGAACQX1+xQAAAABJRU5ErkJggg==",
      "base64",
    );
    return nativeImage.createFromBuffer(buf);
  }
  return nativeImage.createEmpty();
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  try { mainWindow.webContents.send("jarvis:visibility-changed", true); } catch { /* noop */ }
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  try { mainWindow.webContents.send("jarvis:visibility-changed", false); } catch { /* noop */ }
}

function toggleVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const isVisible = mainWindow ? mainWindow.isVisible() : false;
  const menu = Menu.buildFromTemplate([
    {
      label: isVisible ? "Hide JARVIS" : "Show JARVIS",
      click: () => (isVisible ? hideWindow() : showWindow()),
    },
    { type: "separator" },
    {
      label: "Toggle visibility (Ctrl+Shift+Space)",
      click: () => toggleVisibility(),
    },
    { type: "separator" },
    {
      label: "Quit JARVIS",
      click: () => { isQuiting = true; app.quit(); },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  try {
    tray = new Tray(pickTrayIcon());
    tray.setToolTip("J.A.R.V.I.S.");
    tray.on("click", () => toggleVisibility());
    tray.on("double-click", () => showWindow());
    rebuildTrayMenu();
  } catch (e) {
    console.warn("[electron] tray init failed:", e);
  }
}

// ── permissions ───────────────────────────────────────────────────────────

function installPermissionHandlers() {
  const ALLOWED = new Set([
    "media",
    "audioCapture",
    "videoCapture",
    "microphone",
    "camera",
    "display-capture",
    "clipboard-read",
    "clipboard-sanitized-write",
    "notifications",
  ]);
  /** Only the app backend origin — not arbitrary localhost / file / data. */
  const isAppOrigin = (urlStr) => {
    if (!urlStr) return false;
    return urlStr.startsWith(BACKEND_URL) || urlStr === `${BACKEND_URL}/`;
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents?.getURL?.() || "";
    callback(isAppOrigin(url) && ALLOWED.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const url = webContents?.getURL?.() || requestingOrigin || "";
    return isAppOrigin(url) && ALLOWED.has(permission);
  });

  // CSP for the loaded app page (loopback backend serves the HUD).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: mediastream:",
      "font-src 'self' data:",
      `connect-src 'self' ws://127.0.0.1:${BACKEND_PORT} ws://localhost:${BACKEND_PORT} http://127.0.0.1:${BACKEND_PORT} http://localhost:${BACKEND_PORT}`,
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    headers["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: headers });
  });
}

// ── main window ───────────────────────────────────────────────────────────

function boundsStorePath() {
  return path.join(app.getPath("userData"), "window-bounds.json");
}

function loadStoredBounds() {
  try {
    const raw = fs.readFileSync(boundsStorePath(), "utf-8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object") return j;
  } catch { /* missing or corrupt — ignore */ }
  return {};
}

function saveStoredBounds(patch) {
  try {
    const cur = loadStoredBounds();
    const next = { ...cur, ...patch };
    fs.writeFileSync(boundsStorePath(), JSON.stringify(next));
  } catch { /* disk full / readonly — non-fatal */ }
}

function persistCurrentBounds() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
  try {
    const b = mainWindow.getBounds();
    saveStoredBounds({ full: b });
  } catch { /* noop */ }
}

function pickInitialBounds() {
  const store = loadStoredBounds();
  // Prefer the flat "full" key; also accept a legacy top-level bounds object
  // that has width/height directly (older single-mode saves).
  const saved = store.full && store.full.width ? store.full
    : (store.width ? store : null);
  if (!saved) return { width: FULL_W, height: FULL_H };
  // Validate the saved bounds intersect a current display so we don't
  // restore the window off-screen after a monitor change.
  const displays = screen.getAllDisplays();
  const fits = displays.some((d) => {
    const a = d.workArea;
    return (
      saved.x < a.x + a.width &&
      saved.x + saved.width > a.x &&
      saved.y < a.y + a.height &&
      saved.y + saved.height > a.y
    );
  });
  if (!fits) return { width: FULL_W, height: FULL_H };
  return saved;
}

function createWindow() {
  const init = pickInitialBounds();
  mainWindow = new BrowserWindow({
    width: init.width || FULL_W,
    height: init.height || FULL_H,
    x: init.x,
    y: init.y,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#03070f",
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // External https only via OS browser; never navigate the app shell away.
    if (/^https:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(BACKEND_URL)) {
      e.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // Close → hide to tray. Quit only via tray menu / isQuiting flag.
  mainWindow.on("close", (e) => {
    if (!isQuiting) {
      e.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on("show", rebuildTrayMenu);
  mainWindow.on("hide", rebuildTrayMenu);
  mainWindow.on("closed", () => { mainWindow = null; });

  // Persist bounds — debounced via setTimeout to coalesce the rapid stream
  // of `resize` / `move` events Windows fires during a drag.
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; persistCurrentBounds(); }, 250);
  };
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("maximize", scheduleSave);
  mainWindow.on("unmaximize", scheduleSave);

  // HUD interaction: no OS context menu on right-click / long-press.
  mainWindow.webContents.on("context-menu", (e) => {
    e.preventDefault();
  });
}

async function loadApp() {
  if (!mainWindow) return;
  const ok = await waitForBackend(60000);
  if (!ok) {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
      `<html><body style="background:#03070f;color:#7dd3fc;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;">
        <div style="text-align:center">
          <div style="font-size:14px;letter-spacing:0.4em;opacity:0.6">J.A.R.V.I.S.</div>
          <div style="font-size:22px;margin-top:12px">backend not responding on ${BACKEND_URL}</div>
          <div style="font-size:12px;margin-top:24px;opacity:0.55">start it manually: run.bat — then reload (Ctrl+R)</div>
        </div>
      </body></html>`
    )}`);
    return;
  }
  mainWindow.loadURL(BACKEND_URL);
}

// ── IPC ───────────────────────────────────────────────────────────────────

function virtualDisplayBounds() {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) {
    const p = screen.getPrimaryDisplay().bounds;
    return { x: p.x, y: p.y, width: p.width, height: p.height };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const bounds = virtualDisplayBounds();
  overlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "overlay-preload.cjs"),
    },
  });
  // Click-through everywhere except CSS pointer-events:auto regions (control chip).
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  try {
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {
    overlayWindow.setAlwaysOnTop(true);
  }
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadURL(`${BACKEND_URL}/desktop-overlay.html`);
  overlayWindow.on("closed", () => { overlayWindow = null; });
  return overlayWindow;
}

function openDesktopOverlay() {
  overlayWanted = true;
  const win = createOverlayWindow();
  if (!win.isVisible()) win.showInactive();
  // Re-fit if display layout changed.
  try { win.setBounds(virtualDisplayBounds()); } catch { /* noop */ }
}

function closeDesktopOverlay() {
  overlayWanted = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

function installIpc() {
  ipcMain.on("jarvis:wake", () => {
    // Renderer detected the wake word — bring the HUD forward.
    showWindow();
  });
  ipcMain.on("jarvis:show", () => showWindow());
  ipcMain.on("jarvis:hide", () => hideWindow());
  ipcMain.on("jarvis:toggle-visibility", () => toggleVisibility());

  ipcMain.on("jarvis:desktop-overlay-open", () => openDesktopOverlay());
  ipcMain.on("jarvis:desktop-overlay-close", () => closeDesktopOverlay());
  ipcMain.on("jarvis:hands-overlay-frame", (_e, frame) => {
    if (!overlayWanted) return;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("jarvis:overlay-frame", frame);
    }
  });
  ipcMain.on("jarvis:desktop-overlay-meta", (_e, meta) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("jarvis:overlay-meta", meta);
    }
  });
  ipcMain.on("jarvis:overlay-action", (_e, payload) => {
    // Forward overlay chip actions to the main HUD renderer.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("jarvis:desktop-overlay-action", payload);
    }
  });
}

// ── global shortcuts ─────────────────────────────────────────────────────

function installShortcuts() {
  const accel = "CommandOrControl+Shift+Space";
  const ok = globalShortcut.register(accel, toggleVisibility);
  if (!ok) console.warn("[electron] failed to register", accel);

  // Barehands 2.0 emergency stop — always available while Electron is running.
  const stopAccel = "CommandOrControl+Shift+Alt+Escape";
  if (!globalShortcut.register(stopAccel, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("jarvis:desktop-emergency-stop");
    }
  })) {
    console.warn("[electron] failed to register", stopAccel);
  }

  const pauseAccel = "CommandOrControl+Shift+Alt+P";
  if (!globalShortcut.register(pauseAccel, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("jarvis:desktop-overlay-action", {
        action: "toggle-pause",
      });
    }
  })) {
    console.warn("[electron] failed to register", pauseAccel);
  }

  const modeAccel = "CommandOrControl+Shift+Alt+M";
  if (!globalShortcut.register(modeAccel, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("jarvis:desktop-overlay-action", {
        action: "cycle-mode",
      });
    }
  })) {
    console.warn("[electron] failed to register", modeAccel);
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

    app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    installPermissionHandlers();
    installIpc();
    startBackend();
    createWindow();
    createTray();
    installShortcuts();
    loadApp();

    const refitOverlay = () => {
      if (overlayWanted && overlayWindow && !overlayWindow.isDestroyed()) {
        try { overlayWindow.setBounds(virtualDisplayBounds()); } catch { /* noop */ }
      }
    };
    screen.on("display-added", refitOverlay);
    screen.on("display-removed", refitOverlay);
    screen.on("display-metrics-changed", refitOverlay);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        loadApp();
      } else {
        showWindow();
      }
    });
  });
}

app.on("window-all-closed", (e) => {
  // Do NOT quit when window closes — tray keeps the app alive.
  e.preventDefault?.();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  isQuiting = true;
  persistCurrentBounds();
  closeDesktopOverlay();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try { overlayWindow.destroy(); } catch { /* ignore */ }
    overlayWindow = null;
  }
  if (backend) {
    try { backend.kill(); } catch { /* ignore */ }
    backend = null;
  }
});
