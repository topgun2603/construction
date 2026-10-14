import Link from 'next/link';
import { redirect } from 'next/navigation';
import { m365CallbackSchema } from '@sitebook/shared';
import { runAction, serverFetch } from '@/lib/server-api';
import type { M365Overview } from '@/lib/m365-types';
import { getT } from '@/lib/i18n-server';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Connecting Microsoft 365 · BUILDR' };

/**
 * Where Microsoft sends the browser back after "Connect Microsoft 365" — the redirect URI registered
 * in Entra (MS_GRAPH_REDIRECT_URI). A page of the web app rather than an API route on purpose: it
 * runs with the signed-in person's session, so the API can insist that the person finishing the
 * connect is the one who started it, which a bare redirect endpoint could not know.
 *
 * Nothing is rendered on success: the code is redeemed and the browser goes straight back to the
 * integrations page. A refusal (theirs or ours) is shown here with a way back.
 */
export default async function M365CallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getT();
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : undefined);

  let message: string;
  const providerError = one('error');
  const parsed = m365CallbackSchema.safeParse({ code: one('code'), state: one('state') });
  if (providerError) {
    // Microsoft's own words, cut short: "AADSTS65004: User declined to consent…" is what an admin
    // searches for.
    const description = one('error_description')?.split('\n')[0]?.slice(0, 300);
    message = providerError === 'access_denied' ? t('Connecting was cancelled at Microsoft.') : (description ?? providerError);
  } else if (!parsed.success) {
    message = t('Microsoft sent nothing to finish connecting with. Start again from Settings → Integrations.');
  } else {
    // The API directly rather than the server action: revalidating during a render is not allowed,
    // and the page this redirects to is rendered fresh anyway.
    const result = await runAction(() =>
      serverFetch<M365Overview>('/integrations/m365/callback', { method: 'POST', body: parsed.data }),
    );
    if (result.ok) redirect('/settings/integrations?connected=1');
    message = result.error ?? t('Could not finish connecting. Start again.');
  }

  return (
    <Card className="flex max-w-xl flex-col gap-3 p-5">
      <h2 className="text-[17px] font-semibold">{t('Microsoft 365 was not connected')}</h2>
      <p role="alert" className="text-[13.5px] leading-relaxed text-blocked-fg">
        {message}
      </p>
      <Link href="/settings/integrations" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'self-start')}>
        {t('Back to integrations')}
      </Link>
    </Card>
  );
}
