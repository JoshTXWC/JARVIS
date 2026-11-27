/**
 * ChatGPT-style main stage — unused by the HUD App (kept for optional embeds).
 */
import ChatPanel from "./ChatPanel";
import CommandBar from "./CommandBar";
import { useStore } from "../../lib/store";
import { Button } from "@/components/ui/button";

export default function ChatShell() {
  const clearChat = useStore((s) => s.clearChat);
  const undockPanel = useStore((s) => s.undockPanel);
  const docked = useStore((s) => s.dockedPanels);
  const connected = useStore((s) => s.connected);
  const health = useStore((s) => s.health);
  const orbState = useStore((s) => s.orbState);

  return (
    <div className="relative z-10 flex h-full w-full overflow-hidden bg-[var(--background)] pl-[68px]">
      <aside className="hidden sm:flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
        <div className="p-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-11 border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-[15px]"
            onClick={() => clearChat()}
          >
            <PlusIcon />
            New chat
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
          <SidebarRow
            label="Chat window"
            hint={docked.includes("chat") ? "Open" : "On canvas"}
            onClick={() => undockPanel("chat")}
          />
          <SidebarRow
            label="Settings"
            hint={docked.includes("settings") ? "Open" : "On canvas"}
            onClick={() => undockPanel("settings")}
          />
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                connected ? "bg-[var(--success)]" : "bg-[var(--error)]"
              }`}
            />
            <div className="min-w-0">
              <div className="text-sm text-[var(--text-primary)] truncate">J.A.R.V.I.S.</div>
              <div className="text-xs text-[var(--text-secondary)] truncate capitalize">
                {orbState}
                {health?.model?.model ? ` · ${health.model.model}` : ""}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--background)]">
        <div className="flex-1 min-h-0">
          <ChatPanel embedded />
        </div>
        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--background)]">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <CommandBar embedded />
          </div>
        </div>
      </main>
    </div>
  );
}

function SidebarRow({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between gap-2 rounded-lg px-3 h-10 text-[15px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
    >
      <span>{label}</span>
      <span className="text-xs text-[var(--text-secondary)]/70">{hint}</span>
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
