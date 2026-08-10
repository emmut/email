import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { filterMentionContacts, useMention } from "@/components/ui/mention";
import type { Contact } from "@/lib/gmail";

const contacts: Contact[] = [
  { name: "Ann Andersson", email: "ann@x.com", source: "google" },
  { name: "Bo Berg", email: "bo@x.com", source: "icloud" },
  { name: "", email: "cecilia@y.com", source: "google" },
];

describe("filterMentionContacts", () => {
  it("suggests from the top of the list for a bare @", () => {
    expect(filterMentionContacts(contacts, "")).toEqual(contacts);
  });

  it("matches on name, case-insensitively", () => {
    expect(filterMentionContacts(contacts, "aNN")).toEqual([contacts[0]]);
  });

  it("matches on email for nameless contacts", () => {
    expect(filterMentionContacts(contacts, "cecil")).toEqual([contacts[2]]);
  });

  it("returns nothing when nobody matches", () => {
    expect(filterMentionContacts(contacts, "zzz")).toEqual([]);
  });

  it("caps suggestions at 8", () => {
    const many: Contact[] = Array.from({ length: 20 }, (_, i) => ({
      name: `Person ${i}`,
      email: `p${i}@x.com`,
      source: "google",
    }));
    expect(filterMentionContacts(many, "person")).toHaveLength(8);
  });
});

describe("mention extension", () => {
  const buildEditor = () => {
    const { result } = renderHook(() =>
      useMention({ contacts, onMention: () => {} }),
    );
    return new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, result.current.extension!],
      content: "<p>Hi </p>",
    });
  };

  it("serializes a mention as a mailto link", () => {
    const editor = buildEditor();
    editor.commands.insertContent({
      type: "mention",
      attrs: { id: "ann@x.com", label: "Ann Andersson" },
    });
    const html = editor.getHTML();
    expect(html).toContain('href="mailto:ann@x.com"');
    expect(html).toContain(">Ann Andersson</a>");
    editor.destroy();
  });

  it("round-trips its own HTML and keeps the name in plain text", () => {
    const editor = buildEditor();
    editor.commands.insertContent({
      type: "mention",
      attrs: { id: "ann@x.com", label: "Ann Andersson" },
    });
    const html = editor.getHTML();
    editor.commands.setContent(html);
    expect(editor.getHTML()).toBe(html);
    expect(editor.getText()).toContain("Ann Andersson");
    editor.destroy();
  });
});
