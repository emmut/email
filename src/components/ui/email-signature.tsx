import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

import { SignaturePreview } from "@/components/ui/signature-preview";
import { sanitizeSignature } from "@/lib/signature-html";

function SignatureView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper contentEditable={false} className="my-2 overflow-hidden rounded border border-border">
      <div className="bg-muted px-2 py-1 text-xs text-muted-foreground">
        Signature · edit in Settings → Signature
      </div>
      <SignaturePreview html={node.attrs.html as string} />
    </NodeViewWrapper>
  );
}

// Email signatures are opaque to ProseMirror: parsing them as normal rich
// text drops tables, font styles, spacing and image dimensions on every edit.
export const EmailSignature = Node.create({
  name: "emailSignature",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { html: { default: "", rendered: false } };
  },
  parseHTML() {
    return [{
      tag: 'div[data-email-signature="true"]',
      getAttrs: (element) => ({ html: sanitizeSignature(element.innerHTML) }),
    }];
  },
  renderHTML({ node }) {
    const element = document.createElement("div");
    element.setAttribute("data-email-signature", "true");
    element.innerHTML = sanitizeSignature(node.attrs.html as string);
    return element;
  },
  renderText({ node }) {
    return new DOMParser().parseFromString(node.attrs.html as string, "text/html").body.textContent ?? "";
  },
  addNodeView() {
    return ReactNodeViewRenderer(SignatureView);
  },
});
