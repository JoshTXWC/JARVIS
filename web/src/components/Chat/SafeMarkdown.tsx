/**
 * Safe markdown renderer — no raw HTML, escaped text with light formatting,
 * fenced code blocks with copy, collapsible tool cards.
 */
import { useState, type ReactNode } from "react";

export default function SafeMarkdown({ text }: { text: string }) {
  const blocks = splitBlocks(text || "");
  return (
    <div className="safe-md space-y-2">
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return <CodeBlock key={i} lang={b.lang} code={b.body} />;
        }
        if (b.type === "tool") {
          return <ToolCard key={i} title={b.lang} body={b.body} />;
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {inlineFormat(b.body)}
          </p>
        );
      })}
    </div>
  );
}

function splitBlocks(text: string): { type: "text" | "code" | "tool"; lang: string; body: string }[] {
  const out: { type: "text" | "code" | "tool"; lang: string; body: string }[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", lang: "", body: text.slice(last, m.index) });
    const lang = (m[1] || "").toLowerCase();
    const type = lang === "tool" || lang === "tool_call" ? "tool" : "code";
    out.push({ type, lang, body: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", lang: "", body: text.slice(last) });
  return out;
}

function inlineFormat(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()\]]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={i++} className="text-jarvis-aqua font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={i++} className="text-mono text-[12px] px-1 rounded text-jarvis-aqua"
          style={{ background: "rgba(125,211,252,0.1)" }}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok);
      if (mm) {
        parts.push(
          <a key={i++} href={mm[2]} target="_blank" rel="noreferrer noopener"
            className="text-jarvis-aqua underline decoration-jarvis-cyan/40 hover:decoration-jarvis-aqua">
            {mm[1]}
          </a>,
        );
      } else parts.push(tok);
    } else {
      parts.push(
        <a key={i++} href={tok} target="_blank" rel="noreferrer noopener"
          className="text-jarvis-aqua underline decoration-jarvis-cyan/40 break-all">
          {tok}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const highlighted = highlight(code, lang);
  return (
    <div className="rounded-md overflow-hidden" style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.16)" }}>
      <div className="flex items-center justify-between px-2.5 py-1 bg-black/25">
        <span className="text-mono text-[9px] tracking-[0.16em] uppercase text-jarvis-ice/35">
          {lang || "code"}
        </span>
        <button
          type="button"
          className="text-mono text-[9px] tracking-[0.14em] uppercase text-jarvis-ice/45 hover:text-jarvis-ice"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch { /* noop */ }
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="text-mono text-[11px] leading-relaxed p-2.5 overflow-x-auto text-jarvis-ice/80 m-0">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

function ToolCard({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md" style={{ boxShadow: "inset 0 0 0 1px rgba(125,211,252,0.18)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-mono text-[10px] tracking-[0.14em] uppercase text-jarvis-cyan/70"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Tool {title || "call"}</span>
      </button>
      {open && (
        <pre className="text-mono text-[11px] px-2.5 pb-2 text-jarvis-ice/65 whitespace-pre-wrap m-0">
          {body}
        </pre>
      )}
    </div>
  );
}

/** Tiny highlighter — keywords only, HTML-escaped. */
function highlight(code: string, lang: string): string {
  const esc = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (!lang) return esc;
  const kw =
    lang === "python" || lang === "py"
      ? /\b(def|class|return|import|from|if|else|elif|for|while|try|except|with|as|True|False|None|async|await)\b/g
      : lang === "js" || lang === "ts" || lang === "tsx" || lang === "javascript" || lang === "typescript"
        ? /\b(const|let|var|function|return|import|from|if|else|for|while|class|async|await|new|typeof|export|default)\b/g
        : null;
  if (!kw) return esc;
  return esc.replace(kw, '<span style="color:#7dd3fc">$1</span>');
}
