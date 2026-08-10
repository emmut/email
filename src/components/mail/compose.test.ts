import { describe, expect, it } from "vitest";

import {
  addMentionedRecipient,
  hasUnsavedChanges,
  htmlToPlain,
  initialHeaderFields,
  tidySignature,
} from "@/components/mail/compose";
import type { Contact } from "@/lib/gmail";

describe("tidySignature", () => {
  it("strips trailing <br>s inside blocks", () => {
    expect(tidySignature("<div>Emil<br><br></div>")).toBe("<div>Emil</div>");
  });

  it("collapses runs of empty spacer blocks into one <p>", () => {
    expect(
      tidySignature(
        "<div>Emil</div><div><br></div><div><br></div><div>CompileIT</div>",
      ),
    ).toBe("<div>Emil</div><p></p><div>CompileIT</div>");
  });

  it("keeps blocks that contain images", () => {
    const sig = '<div><img src="logo.png"></div>';
    expect(tidySignature(sig)).toBe(sig);
  });

  it("passes plain signatures through", () => {
    expect(tidySignature("<div>Just me</div>")).toBe("<div>Just me</div>");
  });
});

describe("hasUnsavedChanges", () => {
  const replyDraft = { to: "ann@x.com", subject: "Re: hi" };

  it("is pristine right after opening", () => {
    expect(
      hasUnsavedChanges(replyDraft, initialHeaderFields(replyDraft), false),
    ).toBe(false);
  });

  it("detects an edited header field", () => {
    const fields = { ...initialHeaderFields(replyDraft), cc: "bob@x.com" };
    expect(hasUnsavedChanges(replyDraft, fields, false)).toBe(true);
  });

  it("detects an edited body regardless of headers", () => {
    expect(
      hasUnsavedChanges(replyDraft, initialHeaderFields(replyDraft), true),
    ).toBe(true);
  });

  it("does not treat prefilled reply fields as edits", () => {
    expect(initialHeaderFields(replyDraft)).toEqual({
      to: "ann@x.com",
      cc: "",
      bcc: "",
      subject: "Re: hi",
    });
  });
});

describe("htmlToPlain", () => {
  it("extracts text content", () => {
    expect(htmlToPlain("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("returns empty string for empty html", () => {
    expect(htmlToPlain("")).toBe("");
  });
});

describe("addMentionedRecipient", () => {
  const ann: Contact = {
    name: "Ann Andersson",
    email: "ann@x.com",
    source: "google",
  };

  it("adds the mentioned contact to an empty To field", () => {
    expect(addMentionedRecipient("", "", "", ann)).toBe(
      "Ann Andersson <ann@x.com>, ",
    );
  });

  it("appends after existing recipients", () => {
    expect(addMentionedRecipient("bo@x.com, ", "", "", ann)).toBe(
      "bo@x.com, Ann Andersson <ann@x.com>, ",
    );
  });

  it("skips a contact already in To, ignoring case and display name", () => {
    const to = "Ann Andersson <ANN@x.com>, bo@x.com";
    expect(addMentionedRecipient(to, "", "", ann)).toBe(to);
  });

  it("skips a contact already in Cc or Bcc", () => {
    expect(addMentionedRecipient("bo@x.com", "ann@x.com", "", ann)).toBe(
      "bo@x.com",
    );
    expect(addMentionedRecipient("bo@x.com", "", "ann@x.com", ann)).toBe(
      "bo@x.com",
    );
  });

  it("does not confuse a similar address with the mentioned one", () => {
    expect(addMentionedRecipient("joann@x.com", "", "", ann)).toBe(
      "joann@x.com, Ann Andersson <ann@x.com>, ",
    );
  });

  it("uses the bare address for nameless contacts", () => {
    const nameless: Contact = { name: "", email: "c@y.com", source: "icloud" };
    expect(addMentionedRecipient("", "", "", nameless)).toBe("c@y.com, ");
  });
});
