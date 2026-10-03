'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Infinity as InfinityIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PlanView } from '@sitebook/shared';
import { createPlan, deletePlan, updatePlan } from '@/lib/platform-actions';
import { money } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { useLanguage } from '@/components/language-provider';

/**
 * The catalogue, and the form that edits it.
 *
 * Retired plans stay on the page rather than disappearing. An account bought one, and an operator
 * looking at that account needs to see what it was — a plan that vanished from the list would make
 * their plan page read as a code nobody can explain.
 */
export function PlanCatalogue({
  plans,
  canManage,
}: {
  plans: PlanView[];
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<PlanView | null>(null);
  const [adding, setAdding] = useState(false);

  const onSale = plans.filter((plan) => plan.is_active);
  const retired = plans.filter((plan) => !plan.is_active);

  /*
   * Lifetime is pulled out of the grid and given the top of the page.
   *
   * Four equal cards said the four terms were four equal choices. They are not: this is sold on
   * lifetime, and the renewing terms are what somebody takes who is not ready for it yet. A page
   * that does not say which one is the product makes an operator read four prices to work out the
   * answer, every time they open it.
   *
   * By `months === null` rather than by the code `lifetime`, because the term is the real
   * definition — an operator who adds "Forever" tomorrow should get the hero too.
   */
  const lifetime = onSale.find((plan) => plan.months === null) ?? null;
  const terms = onSale.filter((plan) => plan !== lifetime);

  return (
    <div className="flex flex-col gap-5">
      {canManage && !adding && !editing && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> {t('New plan')}
          </Button>
        </div>
      )}

      {(adding || editing) && (
        <PlanForm
          plan={editing}
          onDone={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      {lifetime && (
        <LifetimeHero
          plan={lifetime}
          canManage={canManage}
          onEdit={() => {
            setAdding(false);
            setEditing(lifetime);
          }}
        />
      )}

      {plans.length === 0 ? (
        <EmptyState
          title={t('No plans yet')}
          body={t('Add the terms you sell. Until there is one, nobody can be put on anything.')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(terms.length > 0 || retired.length > 0) && (
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {lifetime ? t('Renewing terms') : t('Terms')}
            </span>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...terms, ...retired].map((plan) => (
            <Card
              key={plan.id}
              className={`flex flex-col gap-3 p-4 ${plan.is_active ? '' : 'opacity-60'} ${
                plan.badge && plan.is_active ? 'border-accent ring-1 ring-accent/25' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {plan.months === null && <InfinityIcon className="size-4 text-accent" />}
                  {plan.name}
                </span>
                {plan.badge && <Badge tone="accent">{plan.badge}</Badge>}
                {!plan.is_active && <Badge tone="neutral">{t('Retired')}</Badge>}
              </div>

              <span className="font-mono text-[20px] font-bold leading-none">
                {money(plan.price)}
              </span>
              <span className="text-[12.5px] text-ink-muted">
                {plan.months === null
                  ? t('Never expires')
                  : `${plan.months} month${plan.months === 1 ? '' : 's'}`}
                {' · '}
                <code className="font-mono text-[11.5px]">{plan.code}</code>
              </span>

              {plan.description && (
                <p className="text-[12.5px] text-ink-soft">{plan.description}</p>
              )}

              {plan.highlights.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {plan.highlights.map((line) => (
                    <li key={line} className="text-[12.5px] text-ink-muted">
                      · {line}
                    </li>
                  ))}
                </ul>
              )}

              {canManage && (
                <div className="mt-auto flex items-center gap-1 pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAdding(false);
                      setEditing(plan);
                    }}
                  >
                    <Pencil className="size-3.5" /> {t('Edit')}
                  </Button>
                  <ConfirmDialog
                    title={`Delete ${plan.name}?`}
                    body={
                      <>
                        {t('This can only be done while nobody is on it. If accounts are, retire it instead — it stops being sold and keeps meaning something to the people who bought it.')}
                      </>
                    }
                    confirmLabel={t('Delete')}
                    successMessage="Deleted"
                    onConfirm={() => deletePlan(plan.id)}
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-8 text-ink-faint hover:text-blocked-fg"
                        aria-label={`Delete ${plan.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    }
                  />
                </div>
              )}
            </Card>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The lifetime plan, given the top of the page.
 *
 * Dark, because it is the one card here that is a statement rather than a row in a list — the same
 * material as the console's own sign-in door, so the two read as the same product talking about
 * itself. The price is set large and the term is spelled "Never expires" rather than left as an
 * absent month count, since "no end date" is the entire proposition being sold.
 *
 * Deliberately not a second editor. Everything here is a reading of the same plan row the grid
 * below edits, and `Edit` opens that same form — a card that could be edited in two places would
 * eventually disagree with itself about what the price is.
 */
function LifetimeHero({
  plan,
  canManage,
  onEdit,
}: {
  plan: PlanView;
  canManage: boolean;
  onEdit: () => void;
}) {
  const { t } = useLanguage();

  return (
    <Card className="relative isolate overflow-hidden border-0 bg-nav p-0">
      {/* One accent bloom, as on the console door. Static: a plan card is not a thing to animate. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 size-[320px] rounded-full bg-accent/30 blur-[90px]"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-6 p-6">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.16em] text-accent-onDark">
            <InfinityIcon className="size-4" />
            {plan.badge ?? t('What we sell')}
          </span>

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-white">
              {plan.name}
            </span>
            <span className="font-mono text-[28px] font-bold leading-none text-accent-onDark">
              {money(plan.price)}
            </span>
          </div>

          <p className="max-w-[52ch] text-[13.5px] leading-relaxed text-white/60">
            {plan.description ??
              t('Paid once. The account never expires, and there is no renewal to miss.')}
          </p>

          {plan.highlights.length > 0 && (
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
              {plan.highlights.map((line) => (
                <li
                  key={line}
                  className="flex items-center gap-1.5 text-[12.5px] text-white/70"
                >
                  <Check className="size-3.5 flex-none text-accent-onDark" />
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col items-start gap-2.5">
          <span className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[12px] font-semibold text-white/80 ring-1 ring-inset ring-white/[0.12]">
            {t('Never expires')} · <code className="font-mono">{plan.code}</code>
          </span>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil className="size-3.5" /> {t('Edit')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Adding a plan, or changing one.
 *
 * The code is fixed once set: it is what every tenant row points at, and renaming it would orphan
 * every account on that plan. The form says so rather than letting somebody find out.
 */
function PlanForm({ plan, onDone }: { plan: PlanView | null; onDone: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [lifetime, setLifetime] = useState(plan ? plan.months === null : false);
  const [active, setActive] = useState(plan ? plan.is_active : true);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const months = lifetime ? null : Number.parseInt(String(formData.get('months') ?? ''), 10);
    if (!lifetime && (!Number.isFinite(months) || (months ?? 0) < 1)) {
      setError('How many months does this run for?');
      return;
    }

    // Rupees in the field, paise on the wire — money is integer paise everywhere in this product.
    const rupees = String(formData.get('price') ?? '').replace(/[,\s₹]/g, '');
    if (!/^\d+$/.test(rupees)) {
      setError('Enter the price in whole rupees');
      return;
    }
    const price = `${BigInt(rupees) * 100n}`;

    const highlights = String(formData.get('highlights') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    start(async () => {
      const shared = {
        name: String(formData.get('name') ?? '').trim(),
        months,
        price,
        description: String(formData.get('description') ?? '').trim() || null,
        badge: String(formData.get('badge') ?? '').trim() || null,
        highlights,
        is_active: active,
        sort_order: Number.parseInt(String(formData.get('sort_order') ?? '0'), 10) || 0,
      };

      const result = plan
        ? await updatePlan(plan.id, shared)
        : await createPlan({ ...shared, code: String(formData.get('code') ?? '').trim() });

      if (!result.ok) {
        setError(result.error ?? 'Could not save the plan');
        return;
      }
      toast.success(plan ? 'Plan updated' : 'Plan added');
      onDone();
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <span className="text-[15px] font-semibold">{plan ? `Edit ${plan.name}` : t('New plan')}</span>

      <form action={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Name')} htmlFor="name">
            <Input
              id="name"
              name="name"
              required
              defaultValue={plan?.name ?? ''}
              placeholder="2 years"
            />
          </Field>

          {plan ? (
            <Field label={t('Code')}>
              <Input value={plan.code} readOnly disabled />
            </Field>
          ) : (
            <Field label={t('Code')} htmlFor="code">
              <Input
                id="code"
                name="code"
                required
                placeholder="two_years"
                pattern="[a-z0-9_]+"
              />
            </Field>
          )}
        </div>

        {plan && (
          <p className="-mt-2 text-[12px] text-ink-faint">
            {t('The code cannot change — every account on this plan points at it.')}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Price (₹)')} htmlFor="price">
            <Input
              id="price"
              name="price"
              inputMode="numeric"
              required
              defaultValue={plan ? String(BigInt(plan.price) / 100n) : ''}
              placeholder="9999"
            />
          </Field>

          <Field label={t('Months')} htmlFor="months">
            <Input
              id="months"
              name="months"
              inputMode="numeric"
              disabled={lifetime}
              defaultValue={plan?.months ?? ''}
              placeholder="12"
            />
          </Field>

          <Field label={t('Order')} htmlFor="sort_order">
            <Input
              id="sort_order"
              name="sort_order"
              inputMode="numeric"
              defaultValue={plan?.sort_order ?? 0}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={lifetime}
            onChange={(event) => setLifetime(event.target.checked)}
          />
          {t('Never expires')}
        </label>

        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          {t('On sale — unticking retires it without affecting anybody already on it')}
        </label>

        <Field label={t('Description')} htmlFor="description" optional>
          <Input
            id="description"
            name="description"
            defaultValue={plan?.description ?? ''}
            placeholder={t('The usual choice.')}
          />
        </Field>

        <Field label={t('Badge')} htmlFor="badge" optional>
          <Input
            id="badge"
            name="badge"
            maxLength={24}
            defaultValue={plan?.badge ?? ''}
            placeholder={t('Best value')}
          />
        </Field>
        <p className="-mt-2 text-[12px] text-ink-faint">
          A ribbon on the card, on the web and in the app — &ldquo;Best value&rdquo;,
          &ldquo;Most popular&rdquo;, &ldquo;Premium&rdquo;. Leave it empty for a plan you are not
          pushing. Two or three words at most: it sits beside the name on a phone.
        </p>

        <Field label={t('Highlights')} htmlFor="highlights" optional>
          <textarea
            id="highlights"
            name="highlights"
            rows={3}
            defaultValue={plan?.highlights.join('\n') ?? ''}
            placeholder={'Every feature\nBest value for a running site'}
            className="w-full rounded-btn border border-line-strong bg-surface px-3 py-2 text-[14px] outline-none transition focus:border-accent"
          />
        </Field>
        <p className="-mt-2 text-[12px] text-ink-faint">
          {t('One per line. Every plan has every feature, so these are for terms and promises rather than feature lists.')}
        </p>

        {error && (
          <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? t('Saving…') : plan ? t('Save changes') : 'Add plan'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            {t('Cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
