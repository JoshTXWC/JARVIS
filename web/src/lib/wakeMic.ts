/**
 * Wake-mic control — single entry point so Settings, CommandBar,
 * and boot resume all actually start/stop the microphone (not just a flag).
 */
import { nextId, useStore } from "./store";
import { mic } from "./voice";
import { wsClient } from "./ws";

function jarvisWakeIpc() {
  try {
    (window as any).jarvis?.send?.("jarvis:wake");
  } catch {
    /* noop */
  }
}

/**
 * Enable wake listening and open the mic. Safe to call repeatedly —
 * JarvisMic.start() is a no-op if already listening.
 */
export async function startWakeListening(
  onPartial?: (text: string) => void,
): Promise<void> {
  useStore.getState().setWakeEnabled(true);
  await mic.start(
    (text, isFinal) => {
      if (isFinal && text.trim()) {
        const trimmed = text.trim();
        useStore.getState().pushChat({
          id: nextId(),
          role: "user",
          text: trimmed,
          ts: Date.now(),
        });
        wsClient.chat(trimmed);
      } else {
        onPartial?.(text);
      }
    },
    (phrase) => {
      console.log("wake phrase:", phrase);
      jarvisWakeIpc();
    },
  );
}

/** Stop the mic and clear the wake-enabled flag. */
export function stopWakeListening(): void {
  mic.stop();
  useStore.getState().setWakeEnabled(false);
}
