import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Keyboard,
  Settings2,
  SlidersHorizontal,
  SquarePen,
  Users,
  type LucideIcon,
} from "lucide-react";

import { AccountsSection } from "@/components/settings/accounts-section";
import { GeneralSection } from "@/components/settings/general-section";
import { RulesSection } from "@/components/settings/rules-section";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { SignatureSection } from "@/components/settings/signature-section";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAccount } from "@/context/AccountContext";
import { cn, isMac } from "@/lib/utils";

const SECTIONS = [
  "general",
  "accounts",
  "rules",
  "signature",
  "shortcuts",
] as const;
type Section = (typeof SECTIONS)[number];

export const Route = createFileRoute("/settings")({
  validateSearch: (search): { section?: Section } => {
    const section = search.section;
    return SECTIONS.includes(section as Section)
      ? { section: section as Section }
      : {};
  },
  component: SettingsPage,
});

const NAV: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "accounts", label: "Accounts", icon: Users },
  { id: "rules", label: "Mail rules", icon: SlidersHorizontal },
  { id: "signature", label: "Signature", icon: SquarePen },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
];

function SettingsPage() {
  const navigate = useNavigate();
  const { section: initial } = Route.useSearch();
  const [section, setSection] = useState<Section>(initial ?? "general");
  const { activeAccount } = useAccount();

  // Rules and signature are per-account features; they edit the active one.
  const accountScoped = section === "rules" || section === "signature";

  return (
    <div className="flex h-screen flex-col">
      <header
        data-tauri-drag-region
        className={cn(
          "flex items-center gap-2 border-b px-4 py-2",
          isMac && "pt-8",
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/" })}
        >
          <ArrowLeft data-icon="inline-start" />
          Mail
        </Button>
        <h1 className="text-sm font-medium">Settings</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r p-3">
          {NAV.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={section === id ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => setSection(id)}
            >
              <Icon data-icon="inline-start" />
              {label}
            </Button>
          ))}
        </nav>
        <ScrollArea className="min-w-0 flex-1">
          <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
            <div>
              <h2 className="font-medium">
                {NAV.find((n) => n.id === section)?.label}
              </h2>
              {accountScoped && activeAccount && (
                <p className="text-muted-foreground text-xs">
                  For {activeAccount.email} — switch accounts to edit another.
                </p>
              )}
            </div>
            {section === "general" && <GeneralSection />}
            {section === "accounts" && <AccountsSection />}
            {section === "rules" && <RulesSection />}
            {section === "signature" && <SignatureSection />}
            {section === "shortcuts" && <ShortcutsSection />}
          </main>
        </ScrollArea>
      </div>
    </div>
  );
}
