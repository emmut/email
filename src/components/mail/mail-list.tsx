import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Mail } from "@/components/mail/data";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function labelVariant(label: string): "default" | "outline" | "secondary" {
  if (["work", "important"].includes(label)) return "default";
  if (["personal", "budget"].includes(label)) return "outline";
  return "secondary";
}

export function MailList({
  items,
  selectedId,
  onSelect,
}: {
  items: Mail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-4 pt-0">
        {items.map((mail) => (
          <button
            key={mail.id}
            onClick={() => onSelect(mail.id)}
            className={cn(
              "flex flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent",
              selectedId === mail.id && "bg-muted",
            )}
          >
            <div className="flex w-full flex-col gap-1">
              <div className="flex items-center">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{mail.name}</span>
                  {!mail.read && (
                    <span className="flex size-2 rounded-full bg-blue-600" />
                  )}
                </div>
                <span
                  className={cn(
                    "ml-auto text-xs",
                    selectedId === mail.id
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {formatDate(mail.date)}
                </span>
              </div>
              <span className="text-xs font-medium">{mail.subject}</span>
            </div>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {mail.text.substring(0, 300)}
            </span>
            {mail.labels.length ? (
              <div className="flex items-center gap-2">
                {mail.labels.map((label) => (
                  <Badge key={label} variant={labelVariant(label)}>
                    {label}
                  </Badge>
                ))}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
