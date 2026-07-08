import { Archive, Reply, ReplyAll, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Mail } from "@/components/mail/data";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function MailDisplay({ mail }: { mail: Mail | null }) {
  if (!mail) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-sm">
        No message selected
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Archive className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Move to trash</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Reply className="size-4" />
          </Button>
          <Button variant="ghost" size="icon">
            <ReplyAll className="size-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <div className="flex items-start gap-4 p-4">
        <Avatar>
          <AvatarFallback>{initials(mail.name)}</AvatarFallback>
        </Avatar>
        <div className="grid gap-1">
          <div className="font-semibold">{mail.name}</div>
          <div className="text-xs line-clamp-1">{mail.subject}</div>
          <div className="text-muted-foreground text-xs">{mail.email}</div>
        </div>
        <div className="text-muted-foreground ml-auto text-xs">
          {new Date(mail.date).toLocaleString()}
        </div>
      </div>
      <Separator />
      <div className="flex-1 overflow-auto p-4 text-sm whitespace-pre-wrap">
        {mail.text}
      </div>
    </div>
  );
}
