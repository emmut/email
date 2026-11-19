import { useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { Code2 } from "lucide-react";

import { Button } from "@/components/ui/button";

const extensions = [
  html(),
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({ "aria-label": "Signature HTML" }),
];

export function HtmlEditor({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [formatting, setFormatting] = useState(false);
  const current = useRef(value);
  current.current = value;

  async function formatHtml() {
    const source = current.current;
    setFormatting(true);
    setError(null);
    try {
      const [prettier, parser] = await Promise.all([
        import("prettier/standalone"),
        import("prettier/plugins/html"),
      ]);
      const formatted = await prettier.format(source, {
        parser: "html",
        plugins: [parser],
        htmlWhitespaceSensitivity: "strict",
        tabWidth: 2,
      });
      // Don't overwrite typing that happened while the formatter loaded.
      if (current.current === source) onChange(formatted);
    } catch {
      setError("Could not format this HTML. Check for incomplete or mismatched tags.");
    } finally {
      setFormatting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-input">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Code2 className="size-3.5" />HTML</span>
        <Button type="button" variant="ghost" size="sm" disabled={formatting} onClick={formatHtml}>
          {formatting ? "Formatting…" : "Format HTML"}
        </Button>
      </div>
      <CodeMirror
        value={value}
        onChange={(next) => { setError(null); onChange(next); }}
        extensions={extensions}
        minHeight="200px"
        maxHeight="400px"
        theme={document.documentElement.classList.contains("dark") ? "dark" : "light"}
        basicSetup={{ foldGutter: true, autocompletion: true }}
        className="text-sm"
      />
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
