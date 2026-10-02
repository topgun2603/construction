import { KeyRound, Phone, ShieldCheck } from 'lucide-react';
import { requireSelf } from '@/lib/session';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { titleCase } from '@/lib/format';
import { GoogleLink } from './google-link';

export const metadata = { title: 'Your account · BUILDR' };

/**
 * Who you are signed in as, and how you get back in.
 *
 * Outside `/settings`, deliberately: those tabs are the company's settings and only an owner has
 * any business there, while this page is about one person and everybody has one. A supervisor who
 * wants to sign in with Google must be able to reach the switch.
 */
export default async function AccountPage() {
  const me = await requireSelf();

  return (
    <FadeIn className="flex max-w-[760px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold leading-tight">Your account</h1>
        <p className="text-[13.5px] text-ink-muted">
          How you sign in, and what this login can see.
        </p>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[17px] font-semibold leading-tight">{me.user.name}</span>
            <span className="text-[13.5px] text-ink-muted">
              {me.role_name || titleCase(me.user.role)} · {me.tenant.name}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-9 flex-none items-center justify-center rounded-control bg-neutral-bg">
              <Phone className="size-4 text-ink-soft" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-[12.5px] text-ink-muted">Mobile number</span>
              <span className="font-mono text-[14.5px] font-medium">+{me.user.phone}</span>
            </div>
            <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-ink-faint">
              <ShieldCheck className="size-3.5" />
              Always works
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
            <span className="flex size-9 flex-none items-center justify-center rounded-control bg-neutral-bg">
              <KeyRound className="size-4 text-ink-soft" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-[12.5px] text-ink-muted">Google account</span>
              <span className="text-[13.5px] text-ink-soft">
                {me.user.email
                  ? 'Sign in with one tap, no code to wait for.'
                  : 'Optional. Link it to skip the SMS code when you are at a desk.'}
              </span>
            </div>
            <div className="ml-auto">
              <GoogleLink email={me.user.email} />
            </div>
          </div>
        </div>
      </Card>
    </FadeIn>
  );
}
