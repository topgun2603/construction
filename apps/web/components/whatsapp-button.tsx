'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { whatsappHref } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Opens WhatsApp with a message already written, addressed to one person.
 *
 * The message goes from the builder's own number, out of their own WhatsApp — BUILDR only composes
 * it. Sending on their behalf would mean automating a personal WhatsApp account, which breaks
 * WhatsApp's terms and gets numbers banned; the number at risk would be the one their clients and
 * suppliers already reach them on, so it is not a trade worth making. Automated sends go through the
 * company's Cloud API number instead.
 *
 * `window.open` on click rather than an `<a href>` because the message carries this app's own URL,
 * and the server rendering the page does not know what address the browser reached it on.
 */
export function WhatsappButton({
  phone,
  message,
  path,
  label = 'WhatsApp',
  variant = 'secondary',
  size = 'sm',
  iconOnly = false,
  className,
}: {
  /** E.164 without the plus, as stored. A number that cannot be dialled hides the button. */
  phone: string | null | undefined;
  /** The message, with `{url}` wherever the link belongs. */
  message: string;
  /** Path the link should point at, resolved against wherever this app is being served from. */
  path: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function compose(): string {
    return message.replace('{url}', `${window.location.origin}${path}`);
  }

  // No dialable number, no button: a chat with nobody is worse than an absent control.
  if (!whatsappHref(phone, 'x')) return null;

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn('gap-2', className)}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => {
          const href = whatsappHref(phone, compose());
          if (!href) return;
          // A named target, so repeated sends reuse one tab instead of littering the browser.
          window.open(href, '_blank', 'noopener,noreferrer');
        }}
      >
        <WhatsappGlyph />
        {!iconOnly && label}
      </Button>

      {!iconOnly && (
        // The fallback for a desktop with no WhatsApp installed, and for anyone who would rather
        // paste it into SMS, email or a group.
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Copy the message instead"
          title="Copy the message instead"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(compose());
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error('Could not copy — your browser blocked it');
            }
          }}
        >
          {copied ? <Check className="size-4 text-done-fg" /> : <Copy className="size-4" />}
        </Button>
      )}
    </span>
  );
}

/**
 * The WhatsApp mark.
 *
 * Drawn rather than borrowed from the icon set: a generic speech bubble beside the word "WhatsApp"
 * makes people hesitate over whether it really opens WhatsApp, and hesitation is the whole cost of
 * a share button.
 */
function WhatsappGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn('size-4', className)}
    >
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.88 9.88 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.13h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.21-8.24 8.21Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42-.14-.01-.31-.01-.47-.01-.16 0-.43.06-.65.31-.22.25-.85.84-.85 2.04s.87 2.37 1 2.53c.12.16 1.72 2.62 4.16 3.68.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}
