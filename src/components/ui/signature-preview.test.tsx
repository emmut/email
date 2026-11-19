import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SignaturePreview } from '@/components/ui/signature-preview';

describe('signature visual editor', () => {
  it('preserves the editing document and table layout as text is changed', async () => {
    const original =
      '<table style="color: red"><tbody><tr><td>Jane</td><td><img src="https://example.com/logo.png" width="96"></td></tr></tbody></table>';
    const onChange = vi.fn();
    const { rerender } = render(<SignaturePreview html={original} editable onChange={onChange} />);
    const frame = screen.getByTitle('Signature visual editor') as HTMLIFrameElement;
    // jsdom doesn't load srcDoc; populate the child document and dispatch load.
    const body = frame.contentDocument!.body;
    body.innerHTML = original;
    fireEvent.load(frame);
    expect(body.contentEditable).toBe('true');
    // No input event: WebKit never delivers it to the sandboxed frame, so
    // edits must be picked up from the DOM mutation alone.
    body.querySelector('td')!.textContent = 'Jane Doe';
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const edited = onChange.mock.calls[0][0] as string;
    expect(edited).toContain('Jane Doe');
    expect(edited).toContain('style="color: red"');
    expect(edited).toContain('width="96"');
    const source = frame.srcdoc;
    rerender(<SignaturePreview html={edited} editable onChange={onChange} />);
    expect(frame.srcdoc).toBe(source);
    expect(frame.contentDocument!.body).toBe(body);
  });

  it('isolates preview styles and strips executable HTML', () => {
    render(
      <SignaturePreview
        html={
          '<img src="https://example.com/logo.png" onerror="alert(1)"><script>alert(1)</script>'
        }
      />,
    );
    const frame = screen.getByTitle('Signature preview') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.srcdoc).not.toContain('onerror');
    expect(frame.srcdoc).not.toContain('<script>');
    expect(frame.srcdoc).toContain('Content-Security-Policy');
  });
});
