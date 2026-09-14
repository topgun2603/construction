'use client';

import { useState, useTransition } from 'react';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { workerSelfServiceLink } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { WhatsappButton } from '@/components/whatsapp-button';

/**
 * Sends a worker a link to their own record (spec §3 item 15).
 *
 * Minted on demand rather than shown on the page, for two reasons. A link on screen is a link in
 * every screenshot of that screen, and the token in it is the credential. And it expires after
 * thirty days, so one printed into the page would be stale far more often than it was used —
 * pressing the button is what guarantees the link being sent is a live one.
 *
 * Delivery is WhatsApp from the builder's own number, which is how every other message in this
 * product reaches somebody outside the company. A worker has no account here and never will.
 */
export function SelfServiceLink({
  workerId,
  workerName,
  phone,
}: {
  workerId: string;
  workerName: string;
  phone: string | null;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function mint() {
    start(async () => {
      const result = await workerSelfServiceLink(workerId);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? 'Could not make a link');
        return;
      }
      setPath(result.data.path);
    });
  }

  if (!phone) {
    return (
      <p className="text-[12.5px] text-ink-faint">
        Add a mobile number for {workerName} to send them their attendance link.
      </p>
    );
  }

  if (!path) {
    return (
      <Button size="sm" variant="secondary" onClick={mint} disabled={pending}>
        <Link2 className="size-4" />
        {pending ? 'Making a link…' : 'Send them their record'}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <WhatsappButton
        phone={phone}
        path={path}
        label="Send on WhatsApp"
        message={`Hello ${workerName}, here is your attendance and payment record. It works for 30 days: {url}`}
      />
      <span className="text-[12.5px] text-ink-faint">Link works for 30 days</span>
    </div>
  );
}
