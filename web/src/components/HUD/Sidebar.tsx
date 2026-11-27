import { useStore } from "../../lib/store";

export type NavId =
  | "command"
  | "conversations"
  | "tools"
  | "diag"
  | "workflows"
  | "workspace"
  | "settings";

const NAV: { id: NavId; label: string; icon: string }[] = [
  { id: "command",       label: "Home",         icon: "home" },
  { id: "conversations", label: "Chat",         icon: "chat" },
  { id: "tools",         label: "Tools",        icon: "tools" },
  { id: "diag",          label: "System",       icon: "system" },
  { id: "workflows",     label: "Automations",  icon: "flow" },
  { id: "workspace",     label: "Files",        icon: "files" },
];

export default function Sidebar() {
  const activeView = useStore((s) => s.activeView);
  const setActiveView = useStore((s) => s.setActiveView);

  return (
    <aside className="cc-sidebar flex flex-col items-center h-full shrink-0 py-4">
      <div className="mb-5 w-10 h-10 grid place-items-center rounded-xl border border-jarvis-border bg-jarvis-surface/70">
        <ReactorMark />
      </div>

      <nav className="flex-1 flex flex-col items-center gap-1.5">
        {NAV.map((item) => {
          const active =
            activeView === item.id ||
            (item.id === "command" && (activeView === "command" || activeView === "ai-core"));
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-label={item.label}
              onClick={() => setActiveView(item.id)}
              className={`cc-dock-btn ${active ? "active" : ""}`}
            >
              <NavIcon name={item.icon} />
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => setActiveView("settings")}
        className={`cc-dock-btn ${activeView === "settings" ? "active" : ""}`}
      >
        <NavIcon name="settings" />
      </button>
    </aside>
  );
}

function ReactorMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#00C8FF" strokeWidth="1.2" opacity="0.35" />
      <circle cx="12" cy="12" r="5" stroke="#00C8FF" strokeWidth="1.4" />
      <path d="M12 8.5L14.2 12.5H9.8L12 8.5Z" fill="#00C8FF" opacity="0.95" />
    </svg>
  );
}

function NavIcon({ name }: { name: string }) {
  const props = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
  } as const;

  switch (name) {
    case "home":
      return (
        <svg {...props}>
          <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" strokeLinejoin="round" />
        </svg>
      );
    case "chat":
      return (
        <svg {...props}>
          <path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeLinejoin="round" />
        </svg>
      );
    case "tools":
      return (
        <svg {...props}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4L15 12l-2.3-2.3 2-3.4z" strokeLinejoin="round" />
        </svg>
      );
    case "system":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 21h8M12 18v3" strokeLinecap="round" />
        </svg>
      );
    case "flow":
      return (
        <svg {...props}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <path d="M8 7l7 4M8 17l7-4" opacity="0.7" />
        </svg>
      );
    case "files":
      return (
        <svg {...props}>
          <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
        </svg>
      );
    default:
      return <span className="w-5" />;
  }
}
