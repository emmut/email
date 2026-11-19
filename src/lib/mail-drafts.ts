import type { MailBody } from '@/lib/gmail';
import type { ComposeDraft } from '@/components/mail/compose';

function splitAddresses(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// "Name <a@b>" → "a@b"
function bareAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

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
      bareAddress(addr) !== bareAddress(self) && bareAddress(addr) !== bareAddress(body.replyTo)
    );
  }
  const to = all ? [body.replyTo, ...splitAddresses(body.to).filter(notSelf)] : [body.replyTo];
  const cc = all ? splitAddresses(body.cc).filter(notSelf) : [];
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
