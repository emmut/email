import { describe, expect, it } from "vitest";

import { htmlToPlain, tidySignature } from "@/components/mail/compose";

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

describe("htmlToPlain", () => {
  it("extracts text content", () => {
    expect(htmlToPlain("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("returns empty string for empty html", () => {
    expect(htmlToPlain("")).toBe("");
  });
});
