import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignatureSection } from "@/components/settings/signature-section";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/context/AccountContext", () => ({ useAccount: () => ({ activeAccount: { id: "a", kind: "icloud", email: "a@example.com" } }) }));
vi.mock("@/lib/gmail", () => ({ signatureQuery: { queryKey: ["gmail", "signature"], queryFn: async () => "" } }));
vi.mock("@/components/ui/html-editor", () => ({ HtmlEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
  <textarea aria-label="Signature HTML" value={value} onChange={(event) => onChange(event.target.value)} />
) }));

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const data = args as { key: string; json?: string };
    if (command === "cache_get_json") return storage.get(data.key) ?? null;
    if (command === "cache_put_json") { storage.set(data.key, data.json!); return; }
    throw new Error(`Unexpected command: ${command}`);
  });
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SignatureSection /></QueryClientProvider>);
  return userEvent.setup();
}

describe("signature settings", () => {
  it("creates multiple named signatures, duplicates one and preserves HTML", async () => {
    const user = setup();
    const name = await screen.findByRole("textbox", { name: "Signature name" });
    await user.clear(name);
    await user.type(name, "Work");
    await user.click(screen.getByRole("tab", { name: "HTML" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Signature HTML" }), { target: { value: '<img src="https://example.com/logo.png" width="96">' } });
    await user.click(screen.getByRole("button", { name: "Save to library" }));
    await screen.findByRole("status");
    let library = JSON.parse(storage.get("signature-library:v1")!);
    expect(library.signatures[0].name).toBe("Work");
    expect(library.signatures[0].html).toContain('width="96"');
    expect(library.defaults.a).toBe(library.signatures[0].id);
    const workId = library.signatures[0].id;
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getByRole("textbox", { name: "Signature name" })).toHaveValue("Work copy");
    await user.click(screen.getByRole("checkbox", { name: "Use as default for a@example.com" }));
    await user.click(screen.getByRole("button", { name: "Save to library" }));
    await waitFor(() => expect(JSON.parse(storage.get("signature-library:v1")!).signatures).toHaveLength(2));
    library = JSON.parse(storage.get("signature-library:v1")!);
    expect(library.signatures[1].id).not.toBe(workId);
    expect(library.signatures[1].html).toBe(library.signatures[0].html);
    expect(library.defaults.a).toBe(workId);
  });

  it("confirms shared deletion and clears all affected defaults", async () => {
    storage.set("signature-library:v1", JSON.stringify({ signatures: [{ id: "work", name: "Work", html: "<p>Work</p>" }], defaults: { a: "work", b: "work" } }));
    const user = setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("every account");
    await user.click(screen.getByRole("button", { name: "Delete signature" }));
    await waitFor(() => expect(JSON.parse(storage.get("signature-library:v1")!).signatures).toHaveLength(0));
    expect(JSON.parse(storage.get("signature-library:v1")!).defaults).toEqual({ a: null, b: null });
  });

  it("keeps an unsaved draft when persistence fails", async () => {
    const user = setup();
    const name = await screen.findByRole("textbox", { name: "Signature name" });
    await user.clear(name);
    await user.type(name, "Unsaved Work");
    vi.mocked(invoke).mockImplementationOnce(async () => { throw new Error("Disk full"); });
    await user.click(screen.getByRole("button", { name: "Save to library" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
    expect(name).toHaveValue("Unsaved Work");
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    expect(storage.has("signature-library:v1")).toBe(false);
  });
});
