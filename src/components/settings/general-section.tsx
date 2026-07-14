import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/settings";

const SYNC_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 0.5, label: "Every 30 seconds" },
  { minutes: 1, label: "Every minute" },
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 0, label: "Manually" },
];

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{description}</span>
      </div>
      {children}
    </div>
  );
}

export function GeneralSection() {
  const { settings, update, saveError } = useSettings();

  return (
    <div className="flex flex-col divide-y">
      <Row
        title="Check for new mail"
        description="How often the app syncs with the mail server."
      >
        <Select
          value={String(settings.syncIntervalMinutes)}
          onValueChange={(v) =>
            v !== null && update({ syncIntervalMinutes: Number(v) })
          }
          items={SYNC_CHOICES.map((c) => ({
            value: String(c.minutes),
            label: c.label,
          }))}
        >
          <SelectTrigger className="w-44" aria-label="Sync interval">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNC_CHOICES.map((c) => (
              <SelectItem key={c.minutes} value={String(c.minutes)}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row
        title="New mail notifications"
        description="Show a desktop notification when mail arrives in the inbox."
      >
        <Switch
          checked={settings.notificationsEnabled}
          onCheckedChange={(on) => update({ notificationsEnabled: on })}
          aria-label="New mail notifications"
        />
      </Row>
      <Row
        title="Confirm permanent deletion"
        description="Ask before deleting mail forever from Trash."
      >
        <Switch
          checked={settings.confirmPermanentDelete}
          onCheckedChange={(on) => update({ confirmPermanentDelete: on })}
          aria-label="Confirm permanent deletion"
        />
      </Row>
      {saveError != null && (
        <p className="text-destructive pt-3 text-xs">
          Could not save: {String(saveError)}
        </p>
      )}
    </div>
  );
}
