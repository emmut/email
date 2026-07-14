import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Folder,
  Plus,
  SlidersHorizontal,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAccount } from "@/context/AccountContext";
import { createGmailFilter, deleteGmailFilter, tagsQuery } from "@/lib/gmail";
import { icloudFoldersQuery } from "@/lib/icloud";
import {
  canMaterializeGmailFilter,
  gmailFilterCriteria,
  rulesQuery,
  saveRules,
  type MailRule,
  type RuleCondition,
  type RuleField,
} from "@/lib/rules";
import { cn } from "@/lib/utils";

const FIELDS: RuleField[] = ["from", "to", "subject"];

// Manage the active account's mail rules. Gmail rules become server-side
// Gmail filters (they run even when the app is closed); iCloud rules are
// applied by the app whenever new inbox mail is synced.
export function RulesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { activeAccount } = useAccount();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && activeAccount && (
        <RulesForm
          key={activeAccount.id}
          accountId={activeAccount.id}
          isGoogle={activeAccount.kind === "google"}
        />
      )}
    </Dialog>
  );
}

function RulesForm({
  accountId,
  isGoogle,
}: {
  accountId: string;
  isGoogle: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery(rulesQuery(accountId));
  const { data: tags } = useQuery({ ...tagsQuery, enabled: isGoogle });
  const { data: folders } = useQuery({
    ...icloudFoldersQuery(accountId),
    enabled: !isGoogle,
  });

  const [conditions, setConditions] = useState<RuleCondition[]>([
    { field: "from", value: "" },
  ]);
  // null = nothing chosen yet (Base UI's Select shows its placeholder for null).
  const [target, setTarget] = useState<string | null>(null);

  const targets: { id: string; name: string }[] = isGoogle
    ? (tags ?? [])
    : (folders ?? []).map((name) => ({ id: name, name }));
  const targetName = (rule: MailRule) => {
    const action = rule.action;
    return action.kind === "gmail-label"
      ? (tags?.find((t) => t.id === action.labelId)?.name ?? action.labelId)
      : action.folder;
  };

  const persist = async (next: MailRule[]) => {
    await saveRules(accountId, next);
    await queryClient.invalidateQueries({ queryKey: ["rules", accountId] });
  };

  const addRule = useMutation({
    mutationFn: async () => {
      if (target === null) return;
      const trimmed = conditions.map((c) => ({
        field: c.field,
        value: c.value.trim(),
      }));
      const rule: MailRule = {
        id: crypto.randomUUID(),
        enabled: true,
        conditions: trimmed,
        action: isGoogle
          ? { kind: "gmail-label", labelId: target }
          : { kind: "icloud-move", folder: target },
      };
      if (isGoogle) {
        rule.gmailFilterId = await createGmailFilter(
          gmailFilterCriteria(trimmed),
          target,
        );
      }
      await persist([...(rules ?? []), rule]);
    },
    onSuccess: () => {
      setConditions([{ field: "from", value: "" }]);
      setTarget(null);
    },
  });

  const toggleRule = useMutation({
    mutationFn: async (rule: MailRule) => {
      const next = { ...rule, enabled: !rule.enabled };
      // Gmail filters have no enabled flag: disable = delete the server-side
      // filter, enable = recreate it (new id).
      if (rule.action.kind === "gmail-label") {
        if (rule.enabled && rule.gmailFilterId) {
          await deleteGmailFilter(rule.gmailFilterId);
          delete next.gmailFilterId;
        } else if (!rule.enabled) {
          next.gmailFilterId = await createGmailFilter(
            gmailFilterCriteria(rule.conditions),
            rule.action.labelId,
          );
        }
      }
      await persist((rules ?? []).map((r) => (r.id === rule.id ? next : r)));
    },
  });

  const deleteRule = useMutation({
    mutationFn: async (rule: MailRule) => {
      if (rule.gmailFilterId) await deleteGmailFilter(rule.gmailFilterId);
      await persist((rules ?? []).filter((r) => r.id !== rule.id));
    },
  });

  const valid =
    target !== null &&
    conditions.every((c) => c.value.trim().length > 0) &&
    (!isGoogle || canMaterializeGmailFilter(conditions));
  const duplicateFields =
    new Set(conditions.map((c) => c.field)).size !== conditions.length;
  const error = addRule.error ?? toggleRule.error ?? deleteRule.error;
  const TargetIcon = isGoogle ? TagIcon : Folder;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Mail rules</DialogTitle>
      </DialogHeader>

      {(rules ?? []).length === 0 ? (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SlidersHorizontal />
            </EmptyMedia>
            <EmptyTitle>No rules yet</EmptyTitle>
            <EmptyDescription>
              {isGoogle
                ? "Rules tag new incoming mail automatically, right on Google's servers."
                : "Rules file new inbox mail into folders whenever the app syncs."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="divide-y rounded-lg border">
          {(rules ?? []).map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 p-3">
              <Switch
                checked={rule.enabled}
                disabled={toggleRule.isPending}
                onCheckedChange={() => toggleRule.mutate(rule)}
                aria-label="Rule enabled"
              />
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-wrap items-center gap-1.5",
                  !rule.enabled && "opacity-50",
                )}
              >
                {rule.conditions.map((c, i) => (
                  <Fragment key={i}>
                    {i > 0 && (
                      <span className="text-muted-foreground text-xs">and</span>
                    )}
                    <Badge variant="secondary" className="max-w-44 font-normal">
                      <span className="truncate">
                        {c.field}: “{c.value}”
                      </span>
                    </Badge>
                  </Fragment>
                ))}
                <ArrowRight className="text-muted-foreground size-3 shrink-0" />
                <Badge variant="outline" className="max-w-44 font-normal">
                  <TargetIcon data-icon="inline-start" />
                  <span className="truncate">{targetName(rule)}</span>
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive shrink-0"
                disabled={deleteRule.isPending}
                onClick={() => deleteRule.mutate(rule)}
                aria-label="Delete rule"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      <form
        className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) addRule.mutate();
        }}
      >
        <div className="text-sm font-medium">New rule</div>
        {conditions.map((cond, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select
              value={cond.field}
              onValueChange={(field) =>
                setConditions((cs) =>
                  cs.map((c, j) =>
                    j === i ? { ...c, field: field as RuleField } : c,
                  ),
                )
              }
            >
              <SelectTrigger className="w-24 shrink-0" aria-label="Field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground shrink-0 text-sm">
              contains
            </span>
            <Input
              value={cond.value}
              placeholder={
                cond.field === "subject" ? "invoice" : "name@example.com"
              }
              onChange={(e) =>
                setConditions((cs) =>
                  cs.map((c, j) =>
                    j === i ? { ...c, value: e.target.value } : c,
                  ),
                )
              }
            />
            {conditions.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() =>
                  setConditions((cs) => cs.filter((_, j) => j !== i))
                }
                aria-label="Remove condition"
              >
                <X />
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2">
          {conditions.length < FIELDS.length && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setConditions((cs) => [
                  ...cs,
                  {
                    // Default the new row to a field not used yet.
                    field:
                      FIELDS.find((f) => !cs.some((c) => c.field === f)) ??
                      "subject",
                    value: "",
                  },
                ])
              }
            >
              <Plus data-icon="inline-start" /> Condition
            </Button>
          )}
          <span className="text-muted-foreground ml-auto shrink-0 text-sm">
            {isGoogle ? "apply tag" : "move to"}
          </span>
          <Select
            value={target}
            onValueChange={setTarget}
            // Base UI renders the raw value in SelectValue unless it can look
            // the label up here.
            items={targets.map((t) => ({ value: t.id, label: t.name }))}
          >
            <SelectTrigger
              className="max-w-44"
              aria-label={isGoogle ? "Tag" : "Folder"}
            >
              <TargetIcon className="text-muted-foreground size-3.5" />
              <SelectValue placeholder={isGoogle ? "Choose tag…" : "Choose folder…"} />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {targets.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {isGoogle
              ? "Create a tag in the sidebar first — rules apply tags."
              : "Create a folder in the sidebar first — rules move mail into folders."}
          </p>
        )}
        {isGoogle && duplicateFields && (
          <p className="text-destructive text-xs">
            Gmail rules can use each field only once.
          </p>
        )}
        {error != null && (
          <p className="text-destructive text-xs">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {isGoogle
              ? "Runs on Google's servers for new incoming mail."
              : "Applied to new inbox mail when the app syncs."}
          </p>
          <Button type="submit" size="sm" disabled={!valid || addRule.isPending}>
            {addRule.isPending ? "Adding…" : "Add rule"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
