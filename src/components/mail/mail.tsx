import { useState } from "react";
import { Search } from "lucide-react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { MailSidebar } from "@/components/mail/mail-sidebar";
import { MailList } from "@/components/mail/mail-list";
import { MailDisplay } from "@/components/mail/mail-display";
import { mails } from "@/components/mail/data";

export function Mail() {
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(mails[0].id);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const items = tab === "unread" ? mails.filter((m) => !m.read) : mails;
  const selected = mails.find((m) => m.id === selectedId) ?? null;

  return (
    <SidebarProvider>
      <MailSidebar
        activeFolder={activeFolder}
        onSelectFolder={setActiveFolder}
      />
      <SidebarInset className="h-screen overflow-hidden">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "all" | "unread")}
          className="flex h-full flex-col gap-0"
        >
          <header className="flex items-center gap-2 px-4 py-2">
            <SidebarTrigger />
            <h1 className="text-xl font-bold capitalize">{activeFolder}</h1>
            <TabsList className="ml-auto">
              <TabsTrigger value="all">All mail</TabsTrigger>
              <TabsTrigger value="unread">Unread</TabsTrigger>
            </TabsList>
          </header>
          <Separator />
          <div className="bg-background/95 p-4">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-2.5 left-2 size-4" />
              <Input placeholder="Search" className="pl-8" />
            </div>
          </div>
          <Separator />
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel defaultSize="40%" minSize="30%">
              <MailList
                items={items}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="60%" minSize="30%">
              <MailDisplay mail={selected} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </Tabs>
      </SidebarInset>
    </SidebarProvider>
  );
}
