import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// Freeze decorative CSS animations when the HUD is hidden/minimized.
const syncHiddenClass = () => {
  document.documentElement.classList.toggle("jarvis-hidden", document.hidden);
};
syncHiddenClass();
document.addEventListener("visibilitychange", syncHiddenClass);

/** True when the event target is an editable field that needs selection. */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  const el = t.closest("input, textarea, [contenteditable='true']");
  if (!el) return false;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || "text").toLowerCase();
    return !["button", "checkbox", "radio", "submit", "reset", "file", "range", "color", "hidden"].includes(type);
  }
  return true;
}

// Touch/drag = move tiles or click — never highlight text or open a context menu.
document.addEventListener(
  "contextmenu",
  (e) => {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  },
  { capture: true }
);
document.addEventListener(
  "selectstart",
  (e) => {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  },
  { capture: true }
);
document.addEventListener(
  "dragstart",
  (e) => {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  },
  { capture: true }
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
