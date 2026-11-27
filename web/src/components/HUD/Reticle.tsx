/**
 * Reticle disabled — ChatGPT UI uses the normal OS cursor.
 * Magnetic snap / HUD cursor mode intentionally removed.
 */
import { useEffect } from "react";

export default function Reticle() {
  useEffect(() => {
    document.documentElement.classList.remove("jarvis-reticle-hud");
  }, []);
  return null;
}
