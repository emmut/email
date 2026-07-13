import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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

// Native select styled to sit next to shadcn inputs (no Select primitive in
// the ui kit yet).
function FieldSelect({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

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
  const [target, setTarget] = useState("");

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
      setTarget("");
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
    target.length > 0 &&
    conditions.every((c) => c.value.trim().length > 0) &&
    (!isGoogle || canMaterializeGmailFilter(conditions));
  const duplicateFields =
    new Set(conditions.map((c) => c.field)).size !== conditions.length;
  const error = addRule.error ?? toggleRule.error ?? deleteRule.error;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Mail rules</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        {(rules ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No rules yet.</p>
        )}
        {(rules ?? []).map((rule) => (
          <div key={rule.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={rule.enabled}
              disabled={toggleRule.isPending}
              onCheckedChange={() => toggleRule.mutate(rule)}
              aria-label="Rule enabled"
            />
            <span className={cn("flex-1 truncate", !rule.enabled && "text-muted-foreground line-through")}>
              {rule.conditions
                .map((c) => `${c.field} contains “${c.value}”`)
                .join(" and ")}{" "}
              → {targetName(rule)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              disabled={deleteRule.isPending}
              onClick={() => deleteRule.mutate(rule)}
              aria-label="Delete rule"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>

      <Separator />

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) addRule.mutate();
        }}
      >
        <div className="text-sm font-medium">New rule</div>
        {conditions.map((cond, i) => (
          <div key={i} className="flex items-center gap-2">
            <FieldSelect
              value={cond.field}
              onChange={(e) =>
                setConditions((cs) =>
                  cs.map((c, j) =>
                    j === i ? { ...c, field: e.target.value as RuleField } : c,
                  ),
                )
              }
            >
              {FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </FieldSelect>
            <span className="text-muted-foreground text-sm">contains</span>
            <Input
              value={cond.value}
              placeholder={cond.field === "subject" ? "invoice" : "name@example.com"}
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
                size="icon"
                className="size-7 shrink-0"
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
              <Plus /> Condition
            </Button>
          )}
          <span className="text-muted-foreground ml-auto text-sm">
            {isGoogle ? "apply tag" : "move to"}
          </span>
          <FieldSelect
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="max-w-40"
          >
            <option value="" disabled>
              {isGoogle ? "Choose tag…" : "Choose folder…"}
            </option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </FieldSelect>
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
