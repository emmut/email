// Mock data for the inbox layout. Replaced by Gmail query data in Phase 2.

export interface Mail {
  id: string;
  name: string;
  email: string;
  subject: string;
  text: string;
  date: string; // ISO
  read: boolean;
  labels: string[];
}

export const mails: Mail[] = [
  {
    id: "6c84fb90-12c4-11e1-840d-7b25c5ee775a",
    name: "William Smith",
    email: "williamsmith@example.com",
    subject: "Meeting Tomorrow",
    text: "Hi, let's have a meeting tomorrow to discuss the project. I've been reviewing the latest figures and there are a few things I'd like to go over.",
    date: "2026-06-26T09:00:00",
    read: false,
    labels: ["meeting", "work", "important"],
  },
  {
    id: "110e8400-e29b-11d4-a716-446655440000",
    name: "Alice Smith",
    email: "alicesmith@example.com",
    subject: "Re: Project Update",
    text: "Thank you for the project update. It looks great! I've gone through the report, and the progress is impressive.",
    date: "2026-06-26T07:45:00",
    read: true,
    labels: ["work", "important"],
  },
  {
    id: "3e7c3f6d-bdf5-46ae-8d90-171300f27ae2",
    name: "Bob Johnson",
    email: "bobjohnson@example.com",
    subject: "Weekend Plans",
    text: "Any plans for the weekend? I was thinking of going hiking in the nearby mountains. It's been a while since we had some outdoor fun.",
    date: "2026-06-25T18:20:00",
    read: true,
    labels: ["personal"],
  },
  {
    id: "61c35085-72d7-42b4-8d62-738f700d4b92",
    name: "Emily Davis",
    email: "emilydavis@example.com",
    subject: "Re: Question about Budget",
    text: "I have a question about the budget for the upcoming project. It seems like there's a discrepancy in the allocation of resources.",
    date: "2026-06-25T11:10:00",
    read: false,
    labels: ["work", "budget"],
  },
  {
    id: "8f7b5db9-d935-4e42-8e05-1f1d0a3dfb97",
    name: "Michael Wilson",
    email: "michaelwilson@example.com",
    subject: "Important Announcement",
    text: "I have an important announcement to make during our team meeting. It pertains to a strategic shift in our approach.",
    date: "2026-06-24T16:00:00",
    read: true,
    labels: ["meeting", "work", "important"],
  },
  {
    id: "1f0f2c02-e299-40de-9b1d-86ef9e42126b",
    name: "Sarah Brown",
    email: "sarahbrown@example.com",
    subject: "Re: Feedback on Proposal",
    text: "Thank you for your feedback on the proposal. It looks great! I'm pleased to hear that you found it satisfactory.",
    date: "2026-06-24T08:30:00",
    read: true,
    labels: ["work"],
  },
];

export type Mail0 = (typeof mails)[number];

export interface MailFolder {
  id: string;
  label: string;
  icon: string; // lucide icon key, resolved in the sidebar
  count?: number;
}

export const folders: MailFolder[] = [
  { id: "inbox", label: "Inbox", icon: "inbox", count: 128 },
  { id: "drafts", label: "Drafts", icon: "file", count: 9 },
  { id: "sent", label: "Sent", icon: "send" },
  { id: "junk", label: "Junk", icon: "archive-x", count: 23 },
  { id: "trash", label: "Trash", icon: "trash2" },
  { id: "archive", label: "Archive", icon: "archive" },
];
