import type { Editor } from "@tiptap/core";
import { sanitizeSignature } from "@/lib/signature-html";

// Change only the composer's signature, never the message or quoted signatures.
// An empty atom keeps its position when choosing "No signature" and typing on.
export function updateComposeSignature(editor: Editor, html: string) {
  const safe = sanitizeSignature(html);
  let found = false;
  editor.state.doc.descendants((node, position) => {
    if (found || node.type.name !== "emailSignature" || !node.attrs.compose) return;
    found = true;
    if (node.attrs.html !== safe) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, html: safe }));
    }
    return false;
  });
  if (!found && safe) {
    // A user may have explicitly deleted the atom. Reinsert before a quote.
    let position = editor.state.doc.content.size;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "blockquote" && offset < position) position = offset;
    });
    editor.commands.insertContentAt(position, { type: "emailSignature", attrs: { html: safe, compose: true } });
  }
}
