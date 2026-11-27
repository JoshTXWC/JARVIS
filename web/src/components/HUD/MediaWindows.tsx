/**
 * AI-opened media / browser / app windows on the HUD canvas.
 * Each Media Bay card becomes its own draggable Floating panel.
 */
import { lazy, Suspense, useMemo } from "react";
import Floating from "./Floating";
import { useStore, type MediaCard, type MediaItem, type MediaKind } from "../../lib/store";
import { cn } from "@/lib/utils";
import WebcamFeed from "../Media/WebcamFeed";

const Model3DViewer = lazy(() => import("../Media/Model3DViewer"));
const NeuralGalaxy = lazy(() => import("../Media/NeuralGalaxy"));

const TITLE: Partial<Record<MediaKind, string>> = {
  page: "Browser",
  pdf: "Document",
  search: "Search",
  news: "News",
  image: "Image",
  images: "Images",
  video: "Video",
  videos: "Videos",
  webcam: "Camera",
  galaxy: "Memory",
  model3d: "3D",
};

function defaultBoxFor(card: MediaCard, index: number) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const browserish = card.kind === "page" || card.kind === "pdf" || card.kind === "search";
  const w = browserish ? Math.min(720, Math.round(vw * 0.42)) : Math.min(560, Math.round(vw * 0.36));
  const h = browserish ? Math.min(640, Math.round(vh * 0.62)) : Math.min(480, Math.round(vh * 0.48));
  const col = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: Math.max(88, Math.round(vw * 0.12) + col * 36),
    y: Math.max(56, 72 + row * 40),
    w,
    h,
  };
}

export default function MediaWindows() {
  const media = useStore((s) => s.media);
  // Newest first, cap so the canvas does not explode.
  const cards = useMemo(() => [...media].sort((a, b) => b.ts - a.ts).slice(0, 8), [media]);

  return (
    <>
      {cards.map((card, i) => (
        <Floating
          key={card.id}
          id={`media-${card.id}`}
          defaultBox={defaultBoxFor(card, i)}
          minW={320}
          minH={240}
          z={60 + i}
        >
          <MediaWindow card={card} />
        </Floating>
      ))}
    </>
  );
}

function MediaWindow({ card }: { card: MediaCard }) {
  const removeMedia = useStore((s) => s.removeMedia);
  const expandMedia = useStore((s) => s.expandMedia);
  const setLightbox = useStore((s) => s.setLightbox);
  const setReader = useStore((s) => s.setReader);
  const title =
    TITLE[card.kind] ||
    card.items[0]?.title ||
    card.summary ||
    card.query ||
    "Media";

  return (
    <div
      className={cn(
        "glass-tile flex h-full min-h-0 flex-col overflow-hidden rounded-xl",
        "border border-white/12",
        "shadow-[0_16px_48px_-16px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
      )}
    >
      <div
        data-drag-handle
        className="shrink-0 flex items-center gap-2 px-3 h-11 border-b border-white/10 cursor-grab active:cursor-grabbing bg-white/[0.04] rounded-t-xl"
      >
        <h3 className="text-sm font-semibold text-foreground/95 truncate flex-1 min-w-0">
          {title}
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
          {card.kind}
        </span>
        <button
          type="button"
          data-no-drag
          onClick={() => removeMedia(card.id)}
          className="size-7 rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
          aria-label="Close window"
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black/20">
        <MediaBody
          card={card}
          onExpand={(idx) => expandMedia(card.id, idx)}
          onLightbox={(kind, item) => setLightbox({ kind, item })}
          onOpenArticle={(url) => setReader(url)}
        />
      </div>
    </div>
  );
}

function MediaBody({
  card,
  onExpand,
  onLightbox,
  onOpenArticle,
}: {
  card: MediaCard;
  onExpand: (idx: number | null) => void;
  onLightbox: (kind: MediaKind, item: MediaItem) => void;
  onOpenArticle: (url: string) => void;
}) {
  if (card.kind === "page" || card.kind === "pdf") {
    const item = card.items[0];
    if (!item?.url) return <Empty label="No page URL" />;
    return (
      <iframe
        src={item.url}
        title={item.title || "Browser"}
        className="h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    );
  }

  if (card.kind === "webcam") {
    return (
      <div className="h-full w-full p-2">
        <WebcamFeed item={card.items[0]} large />
      </div>
    );
  }

  if (card.kind === "galaxy") {
    return (
      <Suspense fallback={<Empty label="Loading…" />}>
        <NeuralGalaxy card={card} large />
      </Suspense>
    );
  }

  if (card.kind === "model3d") {
    return (
      <Suspense fallback={<Empty label="Loading 3D…" />}>
        <div className="h-full w-full p-2">
          <Model3DViewer item={card.items[0]} large />
        </div>
      </Suspense>
    );
  }

  if (card.kind === "video" || card.kind === "videos") {
    const idx = card.expanded ?? 0;
    const v = card.items[idx] || card.items[0];
    if (!v) return <Empty label="No video" />;
    const embed =
      v.embed_url ||
      (v.video_id ? `https://www.youtube.com/embed/${v.video_id}` : null) ||
      (v.url?.includes("youtube") || v.url?.includes("youtu.be") ? v.url : null);
    return (
      <div className="flex h-full min-h-0 flex-col">
        {embed ? (
          <iframe
            src={embed.includes("?") ? `${embed}&rel=0` : `${embed}?rel=0`}
            title={v.title || "Video"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="min-h-0 flex-1 w-full border-0 bg-black"
          />
        ) : (
          <a
            href={v.url}
            target="_blank"
            rel="noreferrer"
            className="m-4 text-sm text-sky-300 underline"
          >
            Open video
          </a>
        )}
        {card.items.length > 1 && (
          <div className="shrink-0 flex gap-1 overflow-x-auto border-t border-white/10 p-2">
            {card.items.map((it, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onExpand(i)}
                className={cn(
                  "h-12 w-20 shrink-0 overflow-hidden rounded-md border",
                  i === idx ? "border-sky-400" : "border-white/10",
                )}
              >
                {it.thumbnail ? (
                  <img src={it.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-[10px] text-muted-foreground">
                    {i + 1}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (card.kind === "image" || card.kind === "images") {
    return (
      <div className="h-full overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {card.items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onLightbox(card.kind === "image" ? "image" : "images", it)}
              className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/40"
            >
              <img
                src={it.thumbnail || it.url}
                alt={it.title || ""}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // search / news / fallback list
  return (
    <div className="h-full overflow-y-auto p-2 space-y-1">
      {card.items.map((it, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            if (it.url) {
              if (card.kind === "news") onOpenArticle(it.url);
              else onLightbox("page", it);
            }
          }}
          className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[0.06]"
        >
          <div className="text-sm font-medium text-foreground/90 truncate">
            {it.title || it.url}
          </div>
          {it.snippet && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{it.snippet}</div>
          )}
        </button>
      ))}
      {card.items.length === 0 && <Empty label={card.summary || "Empty"} />}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground px-4 text-center">
      {label}
    </div>
  );
}
