import { invoke } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";
import { cacheGet } from "@/lib/cache";

// User-defined mail rules. A rule is a set of AND-ed "field contains value"
// conditions plus one action. Gmail rules are materialized as server-side
// filters (settings.filters) so they run on Google's servers even when the
// app is closed; iCloud has no rules API, so its rules run locally right
// after each inbox sync (see rules-engine.ts) — the resulting move persists
// on the server.

export type RuleField = "from" | "to" | "subject";

export interface RuleCondition {
  field: RuleField;
  value: string; // case-insensitive substring match
}

export type RuleAction =
  | { kind: "gmail-label"; labelId: string }
  | { kind: "icloud-move"; folder: string };

export interface MailRule {
  id: string;
  enabled: boolean;
  conditions: RuleCondition[];
  action: RuleAction;
  // Id of the server-side Gmail filter backing this rule; absent while the
  // rule is disabled (filters have no enabled flag, so disable = delete).
  gmailFilterId?: string;
}

// The subset of a message that rules are evaluated against.
export interface RuleMessage {
  from: string; // display name and/or address
  to: string;
  subject: string;
}

// --- predicates ---

export function conditionMatches(
  cond: RuleCondition,
  msg: RuleMessage,
): boolean {
  const value = cond.value.trim().toLowerCase();
  if (!value) return false;
  return msg[cond.field].toLowerCase().includes(value);
}

export function ruleMatches(rule: MailRule, msg: RuleMessage): boolean {
  return (
    rule.enabled &&
    rule.conditions.length > 0 &&
    rule.conditions.every((c) => conditionMatches(c, msg))
  );
}

// Rules are ordered; the first match decides the action.
export function firstMatchingRule(
  rules: MailRule[],
  msg: RuleMessage,
): MailRule | null {
  return rules.find((r) => ruleMatches(r, msg)) ?? null;
}

// --- Gmail filter mapping ---

export interface GmailFilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
}

// A Gmail filter holds at most one value per criteria field, so a rule maps
// onto a server-side filter only when every field appears once and every
// condition has a value.
export function canMaterializeGmailFilter(
  conditions: RuleCondition[],
): boolean {
  const fields = conditions.map((c) => c.field);
  return (
    conditions.length > 0 &&
    conditions.every((c) => c.value.trim().length > 0) &&
    new Set(fields).size === fields.length
  );
}

export function gmailFilterCriteria(
  conditions: RuleCondition[],
): GmailFilterCriteria {
  const criteria: GmailFilterCriteria = {};
  for (const c of conditions) criteria[c.field] = c.value.trim();
  return criteria;
}

// --- iCloud sync-time evaluation (pure planning half) ---

// The cached-message fields the engine reads (subset of IcloudMessageSummary).
export interface IcloudRuleInput {
  uid: number;
  from_name: string | null;
  from_email: string;
  to: string;
  subject: string;
}

export function icloudRuleMessage(msg: IcloudRuleInput): RuleMessage {
  return {
    from: [msg.from_name, msg.from_email].filter(Boolean).join(" "),
    to: msg.to,
    subject: msg.subject,
  };
}

export function maxUid(messages: { uid: number }[]): number {
  return messages.reduce((max, m) => Math.max(max, m.uid), 0);
}

// Messages that arrived after the previous engine run (cursor = highest UID
// already considered).
export function selectNewMessages<T extends { uid: number }>(
  messages: T[],
  cursor: number,
): T[] {
  return messages.filter((m) => m.uid > cursor);
}

export interface IcloudMove {
  uid: number;
  targetFolder: string;
}

export function planIcloudMoves(
  messages: IcloudRuleInput[],
  rules: MailRule[],
): IcloudMove[] {
  const moves: IcloudMove[] = [];
  for (const msg of messages) {
    const rule = firstMatchingRule(rules, icloudRuleMessage(msg));
    if (rule?.action.kind === "icloud-move") {
      moves.push({ uid: msg.uid, targetFolder: rule.action.folder });
    }
  }
  return moves;
}

// --- persistence (SQLite cache_kv, keyed per account) ---

const rulesKey = (accountId: string) => `rules:v1:${accountId}`;

export async function loadRules(accountId: string): Promise<MailRule[]> {
  return (await cacheGet<MailRule[]>(rulesKey(accountId))) ?? [];
}

// Unlike cachePut this surfaces failures — losing a rule edit silently would
// be worse than an error toast.
export function saveRules(accountId: string, rules: MailRule[]): Promise<void> {
  return invoke("cache_put_json", {
    key: rulesKey(accountId),
    json: JSON.stringify(rules),
  });
}

export function rulesQuery(accountId: string) {
  return queryOptions({
    queryKey: ["rules", accountId],
    queryFn: () => loadRules(accountId),
    enabled: !!accountId,
    staleTime: Infinity,
  });
}
