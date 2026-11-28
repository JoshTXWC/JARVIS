/**
 * Full-bleed chat stage — true background chat, no framed panels.
 * Response orb lives inline in the streaming message (see ChatPanel).
 */
import ChatPanel from "./ChatPanel";
import CommandBar from "./CommandBar";
import VoiceLiveChip from "./VoiceLiveChip";

export default function FullChatStage() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[8] flex pl-[72px]">
      <div className="pointer-events-auto relative flex min-h-0 min-w-0 flex-1 flex-col border-0 bg-transparent shadow-none">
        <VoiceLiveChip />

        <div className="flex h-full min-h-0 w-full flex-col border-0 bg-transparent">
          <div className="min-h-0 flex-1 overflow-hidden border-0 bg-transparent">
            <ChatPanel embedded />
          </div>
          <div className="shrink-0 px-4 pb-4 pt-2 sm:px-8">
            <div className="mx-auto w-full max-w-3xl">
              <CommandBar embedded compactStatus />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
