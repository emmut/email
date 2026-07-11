import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { isMac } from "@/lib/utils";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [isMac ? "⌘" : "Ctrl", "P"], label: "Command palette" },
  { keys: ["c"], label: "Compose" },
  { keys: ["r"], label: "Reply" },
  { keys: ["a"], label: "Reply all" },
  { keys: ["e"], label: "Archive" },
  { keys: ["#"], label: "Move to trash" },
  { keys: ["j"], label: "Next message" },
  { keys: ["k"], label: "Previous message" },
  { keys: ["/"], label: "Search" },
  { keys: ["u"], label: "Mark as unread" },
  { keys: ["Esc"], label: "Back to list" },
  { keys: [isMac ? "⌘" : "Ctrl", "Enter"], label: "Send (in compose)" },
  { keys: ["?"], label: "This help" },
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
