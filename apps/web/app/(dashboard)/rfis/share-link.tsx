'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Link2, Loader2, Mail, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { WhatsappButton } from '@/components/whatsapp-button';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { ActionResult } from '@/lib/server-api';
import type { RfiLink } from '@/lib/rfi-types';

/**
 * Sends the outside party their link: WhatsApp from the builder's own number, an email from their
 * own mail app, or a copied link for anything else. This product has no mail server of its own, and
 * a message from the person the designer actually works with is read sooner than one from a robot.
 *
 * Minted on demand, never printed on the page: the token in it is the credential, and a link in
 * every screenshot of the page is a link anybody can use.
 */
export function ShareLink({
  mint,
  revoke,
  label,
  sentAt,
}: {
  mint: () => Promise<ActionResult<RfiLink>>;
  revoke: () => Promise<ActionResult>;
  label: string;
  sentAt: string | null;
}) {
  const { t } = useLanguage();
  const { instantDate } = useFormat();
  const router = useRouter();
  const [link, setLink] = useState<RfiLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const fullUrl = (value: RfiLink) =>
    value.url.startsWith('http') ? value.url : `${window.location.origin}${value.path}`;

  function make() {
    start(async () => {
      const result = await mint();
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not make a link'));
        return;
      }
      setLink(result.data);
      router.refresh();
    });
  }

  function withdraw() {
    start(async () => {
      const result = await revoke();
      if (!result.ok) {
        toast.error(result.error ?? t('Could not withdraw the links'));
        return;
      }
      setLink(null);
      toast.success(t('Every link sent so far has stopped working'));
      router.refresh();
    });
  }

  if (!link) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={make} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          {label}
        </Button>
        {sentAt && (
          <>
            <span className="text-[12.5px] text-ink-faint">
              {t('Link last sent')} {instantDate(sentAt)}
            </span>
            <Button size="sm" variant="ghost" onClick={withdraw} disabled={pending}>
              <Unlink className="size-4" />
              {t('Withdraw links')}
            </Button>
          </>
        )}
      </div>
    );
  }

  const message = () => link.message.replace('{url}', fullUrl(link));
  return (
    <div className="flex flex-col gap-2 rounded-panel border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        {link.phone && (
          <WhatsappButton phone={link.phone} path={link.path} message={link.message} label={t('Send on WhatsApp')} />
        )}
        {link.email && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              window.location.href = `mailto:${encodeURIComponent(link.email!)}?subject=${encodeURIComponent(
                link.subject,
              )}&body=${encodeURIComponent(message())}`;
            }}
          >
            <Mail className="size-4" />
            {t('Email')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message());
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error(t('Could not copy — your browser blocked it'));
            }
          }}
        >
          {copied ? <Check className="size-4 text-done-fg" /> : <Copy className="size-4" />}
          {t('Copy message and link')}
        </Button>
      </div>
      <span className="text-[12.5px] text-ink-faint">
        {t('No sign-in needed. The link works for 30 days, or until you withdraw it.')}
      </span>
    </div>
  );
}
