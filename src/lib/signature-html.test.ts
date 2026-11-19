import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { describe, expect, it } from 'vitest';

import { EmailSignature } from '@/components/ui/email-signature';
import { sanitizeSignature, signatureBlock } from '@/lib/signature-html';

const signature =
  '<table cellpadding="0" cellspacing="0" style="color: rgb(23, 45, 67); font-family: Arial"><tbody><tr><td style="padding-right: 16px"><img src="https://example.com/logo.png" width="96" height="40" alt="Company"></td><td><div style="font-size: 18px">Jane Doe<br><br></div><div><br></div><a href="mailto:jane@example.com">Contact</a></td></tr></tbody></table>';

describe('signature HTML', () => {
  it('preserves tables, inline styles, image sizes and intentional breaks', () => {
    expect(sanitizeSignature(signature)).toBe(signature);
    expect(signatureBlock(signature)).toBe(`<div data-email-signature="true">${signature}</div>`);
  });

  it('keeps image-only signatures and explicitly empty signatures', () => {
    expect(signatureBlock('<img src="https://example.com/logo.png" width="96">')).toContain(
      '<img src="https://example.com/logo.png" width="96">',
    );
    expect(signatureBlock('')).toBe('');
  });

  it('removes active content before previewing or sending', () => {
    const safe = sanitizeSignature(
      '<script>alert(1)</script><img src="https://example.com/logo.png" onerror="alert(1)"><a href="javascript:alert(1)">Click</a><iframe src="https://example.com"></iframe>',
    );
    expect(safe).not.toMatch(/script|onerror|iframe/);
    expect(safe).toContain('<a>Click</a>');
  });

  it('retains the signature when composing, serializing, reopening and editing', () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown, EmailSignature],
      content: `<p>Hello</p>${signatureBlock(signature)}<blockquote><p>Original message</p></blockquote>`,
    });
    try {
      editor.commands.insertContentAt(1, 'Edited ');
      const sent = editor.getHTML();
      expect(sent).toContain(signature);
      expect(sent).toContain('Edited Hello');
      expect(editor.getText()).toContain('Jane Doe');
      // Composer also requests markdown on every keystroke.
      expect(() => editor.getMarkdown()).not.toThrow();
      editor.commands.setContent(sent);
      expect(editor.getHTML()).toContain(signature);
      editor.commands.insertContentAt(1, 'Again ');
      expect(editor.getHTML()).toContain(signature);
    } finally {
      editor.destroy();
    }
  });
});
