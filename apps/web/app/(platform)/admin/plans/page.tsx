import type { PlanView } from '@sitebook/shared';
import { platformFetch } from '@/lib/platform-session';
import { FadeIn } from '@/components/motion';
import { PlanCatalogue } from './plan-catalogue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plans · BUILDR platform' };

/**
 * What the product is sold for.
 *
 * A page rather than a constant in the codebase, because a price is a commercial decision — the
 * sort made on a phone call with a customer — and holding it in code meant a migration and a deploy
 * to change one. Adding "two years" is now an afternoon.
 *
 * Every plan carries every feature; what differs is how long it runs. So the editor asks for a
 * length and a price, and the bullets are for terms and promises — "no renewals, ever" — rather
 * than for feature lists that would be identical four times over.
 */
export default async function PlansPage() {
  const [{ items }, me] = await Promise.all([
    platformFetch<{ items: PlanView[] }>('/plans'),
    platformFetch<{ phone: string; root: boolean }>('/me'),
  ]);

  return (
    <FadeIn className="mx-auto flex max-w-[1400px] flex-col gap-5 px-6 pb-12 pt-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold leading-tight">Plans</h1>
        <p className="text-[13.5px] text-ink-muted">
          What builders can buy. Changes show on their plan page and in the app straight away.
        </p>
      </div>

      <PlanCatalogue plans={items} canManage={me.root} />
    </FadeIn>
  );
}
