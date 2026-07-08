// Shared mail view-model types. Populated from the Gmail API (src/lib/gmail.ts).

export interface Mail {
  id: string;
  name: string;
  email: string;
  subject: string;
  text: string; // snippet in list context
  date: string; // ISO
  read: boolean;
  labelIds: string[]; // raw Gmail label ids (tag membership checks)
  labels: string[]; // user label display names (badges)
}

export interface MailFolder {
  id: string;
  label: string;
  icon: string; // lucide icon key, resolved in the sidebar
}

export const folders: MailFolder[] = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "drafts", label: "Drafts", icon: "file" },
  { id: "sent", label: "Sent", icon: "send" },
  { id: "junk", label: "Junk", icon: "archive-x" },
  { id: "trash", label: "Trash", icon: "trash2" },
  { id: "archive", label: "Archive", icon: "archive" },
];
