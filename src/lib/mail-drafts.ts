import { recipientEmail, splitAddressList } from '@/lib/recipients';
import type { MailBody } from '@/lib/gmail';
import type { ComposeDraft } from '@/components/mail/compose';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function quoteOriginal(body: MailBody): string {
  const source = body.text.trim();
  if (!source) {
    return '';
  }
  const quoted = source.split('\n').map(escapeHtml).join('<br>');
  return (
    `<p></p><p>On ${escapeHtml(body.date)}, ${escapeHtml(body.from)} wrote:</p>` +
    `<blockquote><p>${quoted}</p></blockquote>`
  );
}

export function replyDraft(body: MailBody, all: boolean, self: string): ComposeDraft {
  function notSelf(addr: string) {
    return (
      recipientEmail(addr) !== recipientEmail(self) &&
      recipientEmail(addr) !== recipientEmail(body.replyTo)
    );
  }
  const to = all
    ? [body.replyTo, ...splitAddressList(body.to).filter(Boolean).filter(notSelf)]
    : [body.replyTo];
  const cc = all ? splitAddressList(body.cc).filter(Boolean).filter(notSelf) : [];
  return {
    to: to.join(', '),
    cc: cc.join(', ') || undefined,
    subject: /^re:/i.test(body.subject) ? body.subject : `Re: ${body.subject}`,
    bodyHtml: quoteOriginal(body),
    threadId: body.threadId,
    inReplyTo: body.messageId,
    references: `${body.references} ${body.messageId}`.trim(),
  };
}

export function forwardDraft(body: MailBody): ComposeDraft {
  const headers = [
    `From: ${body.from}`,
    `Date: ${body.date}`,
    `Subject: ${body.subject}`,
    `To: ${body.to}`,
    ...(body.cc ? [`Cc: ${body.cc}`] : []),
  ]
    .map(escapeHtml)
    .join('<br>');
  const quoted = body.text.trim().split('\n').map(escapeHtml).join('<br>');
  return {
    forward: true,
    subject: /^fwd:/i.test(body.subject) ? body.subject : `Fwd: ${body.subject}`,
    bodyHtml:
      `<p></p><p>---------- Forwarded message ----------<br>${headers}</p>` +
      (quoted ? `<blockquote><p>${quoted}</p></blockquote>` : ''),
    threadId: body.threadId,
    references: `${body.references} ${body.messageId}`.trim(),
  };
}
