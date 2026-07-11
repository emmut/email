import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { KEYS } from "@/lib/shortcuts";
import { isMac } from "@/lib/utils";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [isMac ? "⌘" : "Ctrl", "P"], label: "Command palette" },
  { keys: [KEYS.compose], label: "Compose" },
  { keys: [KEYS.reply], label: "Reply" },
  { keys: [KEYS.replyAll], label: "Reply all" },
  { keys: [KEYS.forward], label: "Forward" },
  { keys: [KEYS.archive], label: "Archive" },
  { keys: [KEYS.trash], label: "Move to trash" },
  { keys: [KEYS.junk], label: "Mark as junk / not junk" },
  { keys: [KEYS.nextMessage], label: "Next message" },
  { keys: [KEYS.prevMessage], label: "Previous message" },
  { keys: [KEYS.search], label: "Search" },
  { keys: [KEYS.markUnread], label: "Mark as unread" },
  { keys: [KEYS.markRead], label: "Mark as read" },
  { keys: [isMac ? "⌘" : "Ctrl", "Click"], label: "Select multiple" },
  { keys: ["Shift", "Click"], label: "Select range" },
  { keys: ["Esc"], label: "Back to list" },
  { keys: [isMac ? "⌘" : "Ctrl", "Enter"], label: "Send (in compose)" },
  { keys: [KEYS.help], label: "This help" },
];

export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between text-sm"
            >
              <span>{s.label}</span>
              <KbdGroup>
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </KbdGroup>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
