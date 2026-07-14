import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useKeys } from "@/lib/settings";
import { SHORTCUT_LABELS, type ShortcutAction } from "@/lib/shortcuts";
import { isMac } from "@/lib/utils";

// The single-key actions in help-list order; fixed chords follow separately.
const ACTIONS: ShortcutAction[] = [
  "compose",
  "reply",
  "replyAll",
  "forward",
  "archive",
  "trash",
  "junk",
  "nextMessage",
  "prevMessage",
  "search",
  "markUnread",
  "markRead",
];

const FIXED: { keys: string[]; label: string }[] = [
  { keys: [isMac ? "⌘" : "Ctrl", "P"], label: "Command palette" },
  { keys: [isMac ? "⌘" : "Ctrl", ","], label: "Settings" },
  { keys: [isMac ? "⌘" : "Ctrl", "Click"], label: "Select multiple" },
  { keys: ["Shift", "Click"], label: "Select range" },
  { keys: ["Esc"], label: "Back to list" },
  { keys: [isMac ? "⌘" : "Ctrl", "Enter"], label: "Send (in compose)" },
];

export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const keys = useKeys();
  const shortcuts = [
    FIXED[0],
    ...ACTIONS.map((a) => ({ keys: [keys[a]], label: SHORTCUT_LABELS[a] })),
    ...FIXED.slice(1),
    { keys: [keys.help], label: "This help" },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {shortcuts.map((s) => (
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
