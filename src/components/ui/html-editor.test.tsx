import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Signature HTML" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  EditorView: { lineWrapping: [], contentAttributes: { of: () => [] } },
}));

import { HtmlEditor } from "@/components/ui/html-editor";

describe("HTML editor formatting", () => {
  it("formats HTML on request while preserving email layout attributes", async () => {
    const onChange = vi.fn();
    render(<HtmlEditor value={'<table cellpadding="0"><tr><td style="color:red">Jane</td><td><img src="https://example.com/logo.png" width="96"></td></tr></table>'} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Format HTML" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const formatted = onChange.mock.calls[0][0] as string;
    expect(formatted).toContain('\n');
    expect(formatted).toContain('cellpadding="0"');
    expect(formatted).toContain('style="color:red"');
    expect(formatted).toContain('width="96"');
  });

  it("leaves invalid HTML intact and reports a formatting error", async () => {
    const onChange = vi.fn();
    render(<HtmlEditor value="<div><span>Hello</div>" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Format HTML" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not format");
    expect(onChange).not.toHaveBeenCalled();
  });
});
