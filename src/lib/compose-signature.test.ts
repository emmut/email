import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { EmailSignature } from "@/components/ui/email-signature";
import { updateComposeSignature } from "@/lib/compose-signature";
import { signatureBlock } from "@/lib/signature-html";

function editorFor(signature: string) {
  return new Editor({
    extensions: [StarterKit, EmailSignature],
    content: `<p>My message</p>${signatureBlock(signature, true)}<blockquote><p>Quoted message</p>${signatureBlock("<p>Quoted signature</p>")}</blockquote>`,
  });
}

describe("switching compose signatures", () => {
  it("preserves typed text, quote signatures and selection while replacing the active signature", () => {
    const editor = editorFor("<p>Work</p>");
    try {
      editor.commands.insertContentAt(1, "Typed ");
      editor.commands.setTextSelection(4);
      const selection = editor.state.selection.from;
      updateComposeSignature(editor, '<table><tbody><tr><td>Personal</td></tr></tbody></table>');
      expect(editor.getHTML()).toContain("Typed My message");
      expect(editor.getHTML()).toContain("Quoted message");
      expect(editor.getHTML()).toContain("Quoted signature");
      expect(editor.getHTML()).toContain("<td>Personal</td>");
      expect(editor.getHTML()).not.toContain("<p>Work</p>");
      expect(editor.state.selection.from).toBe(selection);
    } finally { editor.destroy(); }
  });

  it("keeps an insertion point when removing a signature, then restores it before the quote", () => {
    const editor = editorFor("<p>Work</p>");
    try {
      updateComposeSignature(editor, "");
      editor.commands.insertContentAt(1, "More text ");
      updateComposeSignature(editor, '<img src="https://example.com/logo.png" width="96">');
      const html = editor.getHTML();
      expect(html).toContain("More text My message");
      expect(html).toContain('width="96"');
      expect(html.indexOf("logo.png")).toBeLessThan(html.indexOf("Quoted message"));
      expect(html.match(/data-compose-signature/g)).toHaveLength(1);
    } finally { editor.destroy(); }
  });

  it("reopens and switches a draft without duplicating the signature", () => {
    const editor = editorFor("<p>Work</p>");
    try {
      editor.commands.setContent(editor.getHTML());
      updateComposeSignature(editor, "<p>Personal</p>");
      updateComposeSignature(editor, "<p>Work</p>");
      expect(editor.getHTML().match(/data-compose-signature/g)).toHaveLength(1);
      expect(editor.getHTML()).toContain("<p>Work</p>");
      expect(editor.getHTML()).toContain("Quoted signature");
    } finally { editor.destroy(); }
  });
});
