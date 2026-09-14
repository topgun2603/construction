import { ShieldCheck } from 'lucide-react';
import { platformFetch } from '@/lib/platform-session';
import { OperatorControls } from './operator-controls';

export const dynamic = 'force-dynamic';

interface Operator {
  phone: string;
  name: string | null;
  root: boolean;
  granted_by: string | null;
  granted_at: string | null;
}

/**
 * Who can open the console.
 *
 * Two kinds of row, and the difference is the point. **Root** operators come from
 * `PLATFORM_ADMIN_PHONES` on the API: they are always allowed, cannot be removed from here, and
 * are the only ones who may grant access to anybody else. Everyone else holds a grant that a root
 * operator made and can withdraw.
 *
 * That shape is deliberate. The console can change plans and suspend accounts, so a compromised
 * support login must not be able to widen itself or lock out the people who own the deployment.
 * Adding a second support person no longer needs a redeploy; changing who owns the console still
 * does.
 */
export default async function OperatorsPage() {
  const [{ items }, me] = await Promise.all([
    platformFetch<{ items: Operator[] }>('/operators'),
    platformFetch<{ phone: string; root: boolean }>('/me'),
  ]);

  const root = items.filter((item) => item.root);
  const granted = items.filter((item) => !item.root);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Operators</h1>
        <p className="text-[13.5px] text-ink-muted">
          Everyone who can sign in to this console.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          From the deployment config
        </h2>
        <div className="overflow-hidden rounded-panel border border-line bg-surface">
          {root.map((operator) => (
            <div
              key={operator.phone}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0"
            >
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              <span className="font-mono text-[14px]">+{operator.phone}</span>
              <span className="ml-auto text-[12.5px] text-ink-faint">
                Changed by redeploying, not here
              </span>
            </div>
          ))}
        </div>
      </section>

      <OperatorControls granted={granted} canManage={me.root} />
    </div>
  );
}
