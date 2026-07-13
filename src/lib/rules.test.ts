import { describe, expect, it } from "vitest";

import {
  canMaterializeGmailFilter,
  conditionMatches,
  firstMatchingRule,
  gmailFilterCriteria,
  icloudRuleMessage,
  maxUid,
  planIcloudMoves,
  ruleMatches,
  selectNewMessages,
  type MailRule,
  type RuleMessage,
} from "@/lib/rules";

const msg = (over: Partial<RuleMessage> = {}): RuleMessage => ({
  from: "Anna Andersson <anna@example.com>",
  to: "emil.jansson@compileit.com",
  subject: "Invoice 2026-07",
  ...over,
});

const rule = (over: Partial<MailRule> = {}): MailRule => ({
  id: "r1",
  enabled: true,
  conditions: [{ field: "from", value: "anna@example.com" }],
  action: { kind: "icloud-move", folder: "Receipts" },
  ...over,
});

describe("conditionMatches", () => {
  it("matches case-insensitively as a substring", () => {
    expect(
      conditionMatches({ field: "subject", value: "INVOICE" }, msg()),
    ).toBe(true);
  });

  it("matches the from display name as well as the address", () => {
    expect(conditionMatches({ field: "from", value: "andersson" }, msg())).toBe(
      true,
    );
  });

  it("trims the condition value", () => {
    expect(conditionMatches({ field: "to", value: "  compileit  " }, msg())).toBe(
      true,
    );
  });

  it("never matches on an empty value", () => {
    expect(conditionMatches({ field: "from", value: "   " }, msg())).toBe(false);
  });

  it("rejects non-matching values", () => {
    expect(conditionMatches({ field: "subject", value: "receipt" }, msg())).toBe(
      false,
    );
  });
});

describe("ruleMatches", () => {
  it("requires every condition (AND)", () => {
    const r = rule({
      conditions: [
        { field: "from", value: "anna" },
        { field: "subject", value: "invoice" },
      ],
    });
    expect(ruleMatches(r, msg())).toBe(true);
    expect(ruleMatches(r, msg({ subject: "Lunch" }))).toBe(false);
  });

  it("never matches when disabled", () => {
    expect(ruleMatches(rule({ enabled: false }), msg())).toBe(false);
  });

  it("never matches with no conditions", () => {
    expect(ruleMatches(rule({ conditions: [] }), msg())).toBe(false);
  });
});

describe("firstMatchingRule", () => {
  it("returns the first matching rule in order", () => {
    const first = rule({ id: "a", conditions: [{ field: "from", value: "anna" }] });
    const second = rule({ id: "b", conditions: [{ field: "subject", value: "invoice" }] });
    expect(firstMatchingRule([first, second], msg())?.id).toBe("a");
    expect(firstMatchingRule([second, first], msg())?.id).toBe("b");
  });

  it("skips disabled rules", () => {
    const off = rule({ id: "a", enabled: false });
    const on = rule({ id: "b" });
    expect(firstMatchingRule([off, on], msg())?.id).toBe("b");
  });

  it("returns null when nothing matches", () => {
    expect(firstMatchingRule([rule()], msg({ from: "x@y.se" }))).toBeNull();
  });
});

describe("canMaterializeGmailFilter", () => {
  it("accepts distinct fields with values", () => {
    expect(
      canMaterializeGmailFilter([
        { field: "from", value: "a@b.se" },
        { field: "subject", value: "hi" },
      ]),
    ).toBe(true);
  });

  it("rejects duplicate fields (one criteria slot per field)", () => {
    expect(
      canMaterializeGmailFilter([
        { field: "from", value: "a@b.se" },
        { field: "from", value: "c@d.se" },
      ]),
    ).toBe(false);
  });

  it("rejects empty condition lists and blank values", () => {
    expect(canMaterializeGmailFilter([])).toBe(false);
    expect(canMaterializeGmailFilter([{ field: "from", value: " " }])).toBe(
      false,
    );
  });
});

describe("gmailFilterCriteria", () => {
  it("maps conditions onto criteria fields, trimmed", () => {
    expect(
      gmailFilterCriteria([
        { field: "from", value: " a@b.se " },
        { field: "subject", value: "invoice" },
      ]),
    ).toEqual({ from: "a@b.se", subject: "invoice" });
  });
});

describe("icloudRuleMessage", () => {
  it("joins display name and address into the from field", () => {
    expect(
      icloudRuleMessage({
        uid: 1,
        from_name: "Anna",
        from_email: "anna@example.com",
        to: "me@icloud.com",
        subject: "Hi",
      }).from,
    ).toBe("Anna anna@example.com");
  });

  it("falls back to the bare address without a display name", () => {
    expect(
      icloudRuleMessage({
        uid: 1,
        from_name: null,
        from_email: "anna@example.com",
        to: "me@icloud.com",
        subject: "Hi",
      }).from,
    ).toBe("anna@example.com");
  });
});

describe("selectNewMessages / maxUid", () => {
  const uids = [{ uid: 5 }, { uid: 9 }, { uid: 2 }];

  it("keeps only messages above the cursor", () => {
    expect(selectNewMessages(uids, 5)).toEqual([{ uid: 9 }]);
  });

  it("returns everything for cursor 0 and nothing when caught up", () => {
    expect(selectNewMessages(uids, 0)).toHaveLength(3);
    expect(selectNewMessages(uids, 9)).toHaveLength(0);
  });

  it("maxUid is the highest uid, 0 for an empty list", () => {
    expect(maxUid(uids)).toBe(9);
    expect(maxUid([])).toBe(0);
  });
});

describe("planIcloudMoves", () => {
  const message = (uid: number, from_email: string, subject = "") => ({
    uid,
    from_name: null,
    from_email,
    to: "me@icloud.com",
    subject,
  });

  it("plans a move per matching message, first rule wins", () => {
    const rules = [
      rule({
        id: "a",
        conditions: [{ field: "from", value: "shop@" }],
        action: { kind: "icloud-move" as const, folder: "Shopping" },
      }),
      rule({
        id: "b",
        conditions: [{ field: "subject", value: "order" }],
        action: { kind: "icloud-move" as const, folder: "Orders" },
      }),
    ];
    expect(
      planIcloudMoves(
        [
          message(1, "shop@x.se", "Your order"),
          message(2, "friend@x.se", "Lunch?"),
          message(3, "other@x.se", "Order shipped"),
        ],
        rules,
      ),
    ).toEqual([
      { uid: 1, targetFolder: "Shopping" },
      { uid: 3, targetFolder: "Orders" },
    ]);
  });

  it("ignores rules with non-move actions", () => {
    const gmailRule = rule({
      action: { kind: "gmail-label" as const, labelId: "L1" },
    });
    expect(planIcloudMoves([message(1, "anna@example.com")], [gmailRule])).toEqual(
      [],
    );
  });
});
