import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/gmail";

// "Name <a@b>" list entry; quote the name if it would break the comma syntax.
export function formatRecipient(c: Contact): string {
  if (!c.name || c.name === c.email) return c.email;
  const name = /[,<>"]/.test(c.name)
    ? `"${c.name.replace(/"/g, '\\"')}"`
    : c.name;
  return `${name} <${c.email}>`;
}

// Comma-separated recipient field with contact autocomplete on the token
// being typed (the text after the last comma).
export function RecipientInput({
  value,
  onChange,
  contacts,
  placeholder,
  required,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  contacts: Contact[];
  placeholder: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const lastComma = value.lastIndexOf(",");
  const token = value.slice(lastComma + 1).trim().toLowerCase();

  const suggestions = useMemo(() => {
    if (!token) return [];
    const already = new Set(
      value
        .toLowerCase()
        .split(",")
        .map((s) => s.trim()),
    );
    return contacts
      .filter(
        (c) =>
          (c.email.toLowerCase().includes(token) ||
            c.name.toLowerCase().includes(token)) &&
          !already.has(c.email.toLowerCase()),
      )
      .slice(0, 8);
  }, [contacts, token, value]);

  const pick = (contact: Contact) => {
    const kept = lastComma === -1 ? "" : `${value.slice(0, lastComma + 1)} `;
    onChange(`${kept}${formatRecipient(contact)}, `);
    setOpen(false);
  };

  const showList = open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Input
        type="text"
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onBlur={(e) => {
          // Keep open when the click lands on a suggestion (handled onMouseDown)
          if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted(
              (i) => (i - 1 + suggestions.length) % suggestions.length,
            );
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(suggestions[highlighted]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && (
        <div className="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border shadow-md">
          {suggestions.map((c, i) => (
            <button
              key={c.email}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                i === highlighted && "bg-accent text-accent-foreground",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className="flex min-w-0 flex-col">
                {c.name ? (
                  <>
                    <span className="truncate">{c.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {c.email}
                    </span>
                  </>
                ) : (
                  <span className="truncate">{c.email}</span>
                )}
              </span>
              <Badge
                variant="outline"
                className="bg-background ml-auto shrink-0 gap-1 px-1.5 text-[10px]"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    c.source === "google" ? "bg-red-500" : "bg-sky-500",
                  )}
                />
                {c.source === "google" ? "Gmail" : "iCloud"}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
