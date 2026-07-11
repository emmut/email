import { describe, expect, it } from "vitest";

import {
  hasUnsavedChanges,
  htmlToPlain,
  initialHeaderFields,
  tidySignature,
} from "@/components/mail/compose";

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
