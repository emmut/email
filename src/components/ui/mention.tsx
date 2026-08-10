import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Mention from "@tiptap/extension-mention";
import type { Editor, Range } from "@tiptap/react";
import type { SuggestionProps } from "@tiptap/suggestion";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/gmail";

export interface MentionConfig {
  contacts: Contact[];
  onMention: (contact: Contact) => void;
}

// The stock extension types suggestion items as node attrs; ours are whole
// contacts (items() below returns them, so that's what flows through the
// suggestion plugin at runtime).
type ContactSuggestion = SuggestionProps<Contact, Contact>;

// Contacts matching the text typed after "@"; an empty query (bare "@")
// suggests from the top of the list, like Gmail does.
export function filterMentionContacts(
  contacts: Contact[],
  query: string,
): Contact[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
      )
    : contacts;
  return matches.slice(0, 8);
}

// Gmail-style insert: the contact's name as a mailto link, then a space.
// Mirrors the default mention command's overwrite of a following space.
function insertMention(editor: Editor, range: Range, contact: Contact) {
  const nodeAfter = editor.view.state.selection.$to.nodeAfter;
  if (nodeAfter?.text?.startsWith(" ")) range.to += 1;
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: "mention",
        attrs: { id: contact.email, label: contact.name || contact.email },
      },
      { type: "text", text: " " },
    ])
    .run();
}

// Wires TipTap's mention extension to a React-rendered suggestion popup.
// Returns the extension (created once; contacts/onMention are read through
// refs so later renders stay current) and the popup to render alongside the
// editor. Both are null when mentions aren't configured.
export function useMention(config: MentionConfig | undefined): {
  extension: ReturnType<typeof Mention.configure> | null;
  popup: ReactNode;
} {
  const contactsRef = useRef<Contact[]>([]);
  contactsRef.current = config?.contacts ?? [];
  const onMentionRef = useRef<MentionConfig["onMention"] | undefined>(
    undefined,
  );
  onMentionRef.current = config?.onMention;

  const [suggestion, setSuggestion] = useState<ContactSuggestion | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const stateRef = useRef({ suggestion, highlighted });
  stateRef.current = { suggestion, highlighted };

  const [extension] = useState(() => {
    if (!config) return null;

    const handleKey = (event: KeyboardEvent): boolean => {
      const { suggestion, highlighted } = stateRef.current;
      if (!suggestion || suggestion.items.length === 0) return false;
      const count = suggestion.items.length;
      if (event.key === "ArrowDown") {
        setHighlighted((highlighted + 1) % count);
        return true;
      }
      if (event.key === "ArrowUp") {
        setHighlighted((highlighted - 1 + count) % count);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        suggestion.command(suggestion.items[highlighted]);
        return true;
      }
      return false;
    };

    return Mention.extend({
      // Round-trip our mailto-link output (the stock extension only parses
      // its own span markup). Outranks the link mark's a[href] rule.
      parseHTML() {
        return [{ tag: "a[data-mention]", priority: 100 }];
      },
    }).configure({
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => node.attrs.label ?? node.attrs.id ?? "",
      renderHTML: ({ node }) => [
        "a",
        {
          href: `mailto:${node.attrs.id}`,
          "data-mention": "",
          "data-id": node.attrs.id,
          "data-label": node.attrs.label,
        },
        node.attrs.label ?? node.attrs.id ?? "",
      ],
      suggestion: {
        char: "@",
        items: ({ query }) => filterMentionContacts(contactsRef.current, query),
        command: ({ editor, range, props }) => {
          const contact = props as unknown as Contact;
          insertMention(editor, range, contact);
          onMentionRef.current?.(contact);
        },
        render: () => {
          // Esc hides the popup for this trigger; typing on continues the
          // suggestion silently until it exits (@ again starts fresh).
          let dismissed = false;
          return {
            onStart: (props) => {
              dismissed = false;
              setHighlighted(0);
              setSuggestion(props as unknown as ContactSuggestion);
            },
            onUpdate: (props) => {
              if (dismissed) return;
              setHighlighted(0);
              setSuggestion(props as unknown as ContactSuggestion);
            },
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                dismissed = true;
                setSuggestion(null);
                return true;
              }
              if (dismissed) return false;
              return handleKey(event);
            },
            onExit: () => setSuggestion(null),
          };
        },
      },
    });
  });

  const rect = suggestion?.clientRect?.() ?? null;
  const popup =
    suggestion && suggestion.items.length > 0 && rect
      ? createPortal(
          <MentionList
            items={suggestion.items}
            highlighted={highlighted}
            rect={rect}
            onHighlight={setHighlighted}
            onPick={(c) => suggestion.command(c)}
          />,
          document.body,
        )
      : null;

  return { extension, popup };
}

const LIST_WIDTH = 320;

function MentionList({
  items,
  highlighted,
  rect,
  onHighlight,
  onPick,
}: {
  items: Contact[];
  highlighted: number;
  rect: DOMRect;
  onHighlight: (index: number) => void;
  onPick: (contact: Contact) => void;
}) {
  // Anchored under the caret; flips above when the space below is tight.
  const left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - LIST_WIDTH - 8),
  );
  const openUp = rect.bottom + 300 > window.innerHeight && rect.top > 300;
  const position = openUp
    ? { left, bottom: window.innerHeight - rect.top + 4 }
    : { left, top: rect.bottom + 4 };

  return (
    <div
      className="bg-popover text-popover-foreground fixed z-[60] overflow-hidden rounded-lg border shadow-md"
      style={{ ...position, width: LIST_WIDTH }}
    >
      {items.map((c, i) => (
        <button
          key={c.email}
          type="button"
          className={cn(
            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
            i === highlighted && "bg-accent text-accent-foreground",
          )}
          onMouseDown={(e) => {
            e.preventDefault(); // keep editor focus and selection
            onPick(c);
          }}
          onMouseEnter={() => onHighlight(i)}
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
  );
}
