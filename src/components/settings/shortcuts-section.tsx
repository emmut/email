import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useSettings } from "@/lib/settings";
import {
  conflictingActions,
  DEFAULT_KEYS,
  isValidShortcutKey,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  type ShortcutAction,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export function ShortcutsSection() {
  const { settings, update, saveError } = useSettings();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  const keys = { ...DEFAULT_KEYS, ...settings.shortcuts };
  const conflicts = conflictingActions(keys);
  const anyOverride = Object.keys(settings.shortcuts).length > 0;

  // While recording, the next valid keypress becomes the binding; Esc cancels.
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isValidShortcutKey(e.key)) return;
      const next = { ...settings.shortcuts };
      if (e.key === DEFAULT_KEYS[recording]) delete next[recording];
      else next[recording] = e.key;
      void update({ shortcuts: next });
      setRecording(null);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recording, settings.shortcuts, update]);

  return (
    <div className="flex flex-col gap-4">
      <div className="divide-y rounded-lg border">
        {SHORTCUT_ACTIONS.map((action) => {
          const isOverridden = action in settings.shortcuts;
          return (
            <div
              key={action}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-sm">{SHORTCUT_LABELS[action]}</span>
              <span className="flex items-center gap-1">
                {isOverridden && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={`Reset ${SHORTCUT_LABELS[action]} to default`}
                    title={`Reset to "${DEFAULT_KEYS[action]}"`}
                    onClick={() => {
                      const next = { ...settings.shortcuts };
                      delete next[action];
                      void update({ shortcuts: next });
                    }}
                  >
                    <RotateCcw />
                  </Button>
                )}
                <Button
                  variant={recording === action ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "min-w-24",
                    conflicts.has(action) &&
                      recording !== action &&
                      "border-destructive text-destructive",
                  )}
                  onClick={() =>
                    setRecording(recording === action ? null : action)
                  }
                >
                  {recording === action ? (
                    "Press a key…"
                  ) : (
                    <Kbd>{keys[action]}</Kbd>
                  )}
                </Button>
              </span>
            </div>
          );
        })}
      </div>
      {conflicts.size > 0 && (
        <p className="text-destructive text-xs">
          Two actions share the same key — only one of them will run.
        </p>
      )}
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Click a key to change it. Shortcuts are single keys, pressed outside
          of text fields.
        </p>
        {anyOverride && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void update({ shortcuts: {} })}
          >
            Reset all
          </Button>
        )}
      </div>
      {saveError != null && (
        <p className="text-destructive text-xs">
          Could not save: {String(saveError)}
        </p>
      )}
    </div>
  );
}
