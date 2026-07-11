import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useMailActions } from "@/hooks/use-mail-actions";
import type { Mail } from "@/components/mail/data";
import { mail } from "@/test/fixtures";

const gmailApi = vi.hoisted(() => ({
  markRead: vi.fn(),
  markUnread: vi.fn(),
  archiveMessage: vi.fn(),
  trashMessage: vi.fn(),
  junkMessage: vi.fn(),
  notJunkMessage: vi.fn(),
  deleteMessage: vi.fn(),
  applyGmailActionToCache: vi.fn(),
  removeGmailFromCache: vi.fn(),
}));

const queue = vi.hoisted(() => ({
  queueGmailAction: vi.fn(),
  queueIcloudAction: vi.fn(),
}));

vi.mock("@/lib/gmail", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...gmailApi,
}));

vi.mock("@/lib/offline", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...queue,
}));

vi.mock("@/context/AccountContext", () => ({
  useAccount: () => ({
    accounts: [],
    activeAccount: { id: "g1", kind: "google", email: "me@gmail.com" },
    activeAccountId: "g1",
  }),
}));

const LIST_KEY = ["gmail", "list", "inbox", ""];

function setup(onRemoved?: (id: string) => void) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  client.setQueryData<Mail[]>(LIST_KEY, [
    mail({ id: "m1", read: false }),
    mail({ id: "m2", read: true, name: "Bob" }),
  ]);
  client.setQueryData(["gmail", "counts"], { inbox: 1 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useMailActions(onRemoved), { wrapper });
  return { client, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(gmailApi).forEach((fn) => fn.mockResolvedValue(undefined));
});

describe("useMailActions (Gmail)", () => {
  it("marks read optimistically and calls the API", async () => {
    const { client, result } = setup();
    result.current.act("read", "m1");

    // Optimistic: the cached list flips before the network resolves.
    await waitFor(() => {
      expect(client.getQueryData<Mail[]>(LIST_KEY)![0].read).toBe(true);
    });
    await waitFor(() => expect(gmailApi.markRead).toHaveBeenCalledWith("m1"));
    // Unread badge decremented optimistically.
    expect(client.getQueryData(["gmail", "counts"])).toEqual({ inbox: 0 });
  });

  it("archive removes the mail from the list and reports removal", async () => {
    const removed = vi.fn();
    const { client, result } = setup(removed);
    result.current.act("archive", "m1");

    await waitFor(() => {
      expect(
        client.getQueryData<Mail[]>(LIST_KEY)!.map((m) => m.id),
      ).toEqual(["m2"]);
    });
    expect(removed).toHaveBeenCalledWith("m1");
    await waitFor(() =>
      expect(gmailApi.archiveMessage).toHaveBeenCalledWith("m1"),
    );
  });

  it("rolls the cache back when the server rejects", async () => {
    gmailApi.trashMessage.mockRejectedValue(new Error("Google API 500: boom"));
    const { client, result } = setup();
    result.current.act("trash", "m2");

    // The optimistic removal is rolled back once the server rejects.
    await waitFor(() =>
      expect(gmailApi.trashMessage).toHaveBeenCalledWith("m2"),
    );
    await waitFor(() => {
      expect(client.getQueryData<Mail[]>(LIST_KEY)).toHaveLength(2);
    });
    expect(queue.queueGmailAction).not.toHaveBeenCalled();
  });

  it("queues recoverable actions when the network is down", async () => {
    gmailApi.archiveMessage.mockRejectedValue(
      new Error("error sending request to https://gmail"),
    );
    const { result } = setup();
    result.current.act("archive", "m1");

    await waitFor(() =>
      expect(queue.queueGmailAction).toHaveBeenCalledWith("m1", "archive"),
    );
  });

  it("junk removes the mail from the list and mirrors to the cache", async () => {
    const removed = vi.fn();
    const { client, result } = setup(removed);
    result.current.act("junk", "m1");

    await waitFor(() => {
      expect(client.getQueryData<Mail[]>(LIST_KEY)!.map((m) => m.id)).toEqual([
        "m2",
      ]);
    });
    expect(removed).toHaveBeenCalledWith("m1");
    await waitFor(() =>
      expect(gmailApi.junkMessage).toHaveBeenCalledWith("m1"),
    );
    expect(gmailApi.applyGmailActionToCache).toHaveBeenCalledWith("m1", "junk");
  });

  it("not junk calls the SPAM-removal API", async () => {
    const { result } = setup();
    result.current.act("notJunk", "m2");

    await waitFor(() =>
      expect(gmailApi.notJunkMessage).toHaveBeenCalledWith("m2"),
    );
  });

  it("never queues permanent deletes offline", async () => {
    gmailApi.deleteMessage.mockRejectedValue(
      new Error("error sending request to https://gmail"),
    );
    const { client, result } = setup();
    result.current.act("delete", "m1");

    // Failed delete: not journaled, and the optimistic removal rolls back.
    await waitFor(() => {
      expect(client.getQueryData<Mail[]>(LIST_KEY)).toHaveLength(2);
    });
    expect(queue.queueGmailAction).not.toHaveBeenCalled();
    expect(gmailApi.removeGmailFromCache).toHaveBeenCalledWith("m1");
  });
});
