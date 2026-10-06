'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Check, Copy, Loader2, Plus, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CompanyGroupPermission } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { PhoneInput } from '@/components/phone-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import type { ActionResult } from '@/lib/server-api';
import {
  acceptCompanyGroupInvitation,
  createCompanyGroup,
  declineCompanyGroupInvitation,
  grantCompanyGroupAdmin,
  inviteCompanyToGroup,
  setCompanyGroupRate,
  updateCompanyGroup,
} from '@/lib/company-group-actions';
import type { CompanyGroupCompany } from '@/lib/company-group-types';

/**
 * The forms on Settings → Company group. Each one calls a server action, shows the API's own
 * refusal when there is one — most of them are a rule doing its job ("already in a group", "only
 * the owner") — and refreshes the page on success.
 */

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<ActionResult>, success: string, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  }
  return { pending, error, run };
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}

/** Start a group. The founding company's currency is the sensible default for the total. */
export function CreateGroupForm({ defaultCurrency }: { defaultCurrency: string }) {
  const { t } = useLanguage();
  const { pending, error, run } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        createCompanyGroup({
          name: String(data.get('name') ?? ''),
          base_currency: String(data.get('base_currency') ?? defaultCurrency).toUpperCase(),
        }),
      t('Group created'),
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label={t('Group name')} htmlFor="group-name">
          <Input id="group-name" name="name" required minLength={2} placeholder="ARK Holdings" />
        </Field>
        <Field
          label={t('Group currency')}
          htmlFor="group-currency"
          hint={t('The consolidated total is shown in this.')}
        >
          <Input
            id="group-currency"
            name="base_currency"
            defaultValue={defaultCurrency}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            className="font-mono uppercase"
          />
        </Field>
      </div>
      <FormError error={error} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending && <Loader2 className="animate-spin" />}
        {t('Create group')}
      </Button>
    </form>
  );
}

export function RenameGroupForm({ name, baseCurrency }: { name: string; baseCurrency: string }) {
  const { t } = useLanguage();
  const { pending, error, run } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        updateCompanyGroup({
          name: String(data.get('name') ?? ''),
          base_currency: String(data.get('base_currency') ?? baseCurrency).toUpperCase(),
        }),
      t('Group saved'),
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <Field label={t('Group name')} htmlFor="rename-group">
          <Input id="rename-group" name="name" defaultValue={name} required minLength={2} />
        </Field>
        <Field label={t('Group currency')} htmlFor="rename-currency">
          <Input
            id="rename-currency"
            name="base_currency"
            defaultValue={baseCurrency}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            className="font-mono uppercase"
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {t('Save')}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Accept or decline an invitation addressed to this company. Only its owner sees these. */
export function InvitationResponse({ id, groupName }: { id: string; groupName: string }) {
  const { t } = useLanguage();
  const { pending, error, run } = useSubmit();
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => declineCompanyGroupInvitation(id), t('Invitation declined'))}
        >
          <X /> {t('Decline')}
        </Button>
        <Button
          size="sm"
          variant="approve"
          disabled={pending}
          onClick={() =>
            run(() => acceptCompanyGroupInvitation(id), `${t('Joined')} ${groupName}`)
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Check />} {t('Accept and join')}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Invite a company by the id its owner reads off this same page, or by its owner's number. */
export function InviteCompanyForm() {
  const { t } = useLanguage();
  const { pending, error, run } = useSubmit();
  const [by, setBy] = useState<'id' | 'phone'>('id');
  const [formKey, setFormKey] = useState(0);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input =
      by === 'id'
        ? { tenant_id: String(data.get('tenant_id') ?? '').trim() }
        : { owner_phone: String(data.get('owner_phone') ?? '').trim() };
    run(() => inviteCompanyToGroup(input), t('Invitation sent — their owner has to accept it'), () =>
      setFormKey((key) => key + 1),
    );
  }

  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex gap-1 self-start rounded-btn border border-line p-0.5">
        {(['id', 'phone'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setBy(option)}
            aria-pressed={by === option}
            className={
              by === option
                ? 'rounded-[8px] bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent'
                : 'rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-ink-muted hover:text-ink'
            }
          >
            {option === 'id' ? t('By company id') : t('By owner’s mobile')}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        {by === 'id' ? (
          <Field label={t('Company id')} htmlFor="invite-tenant" hint={t('Their owner finds it on this page.')}>
            <Input
              id="invite-tenant"
              name="tenant_id"
              required
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="font-mono"
              dir="ltr"
            />
          </Field>
        ) : (
          <Field label={t('Owner’s mobile number')} htmlFor="invite-phone">
            <PhoneInput id="invite-phone" name="owner_phone" required />
          </Field>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('Invite')}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

const PERMISSION_LABELS: Record<CompanyGroupPermission, string> = {
  'group.view_reports': 'See consolidated reports',
  'group.manage': 'Manage the group',
};

/** Make somebody in one of the group's companies a group admin — named by company and number. */
export function GrantAdminForm({ companies }: { companies: CompanyGroupCompany[] }) {
  const { t } = useLanguage();
  const { pending, error, run } = useSubmit();
  const [tenantId, setTenantId] = useState(companies.find((c) => c.current)?.tenant_id ?? companies[0]?.tenant_id ?? '');
  const [permissions, setPermissions] = useState<CompanyGroupPermission[]>(['group.view_reports']);
  const [formKey, setFormKey] = useState(0);

  function toggle(permission: CompanyGroupPermission) {
    setPermissions((current) =>
      current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission],
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        grantCompanyGroupAdmin({
          tenant_id: tenantId,
          phone: String(data.get('phone') ?? ''),
          permissions,
        }),
      t('Group admin saved'),
      () => setFormKey((key) => key + 1),
    );
  }

  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Their company')} htmlFor="admin-company">
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger id="admin-company">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.map((company) => (
                <SelectItem key={company.tenant_id} value={company.tenant_id}>
                  {company.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={t('Their mobile number there')}
          htmlFor="admin-phone"
          hint={t('They must already be on that company’s team.')}
        >
          <PhoneInput id="admin-phone" name="phone" required />
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-4">
        {(Object.keys(PERMISSION_LABELS) as CompanyGroupPermission[]).map((permission) => (
          <label key={permission} className="flex items-center gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={permissions.includes(permission)}
              onChange={() => toggle(permission)}
              className="size-4 accent-accent"
            />
            {t(PERMISSION_LABELS[permission])}
          </label>
        ))}
      </fieldset>
      <FormError error={error} />
      <Button type="submit" disabled={pending || permissions.length === 0} className="self-start">
        {pending ? <Loader2 className="animate-spin" /> : <UserPlus />}
        {t('Add group admin')}
      </Button>
    </form>
  );
}

/** A manual exchange rate: one unit of a company's currency in the group's currency, from a date. */
export function RateForm({ baseCurrency, currencies }: { baseCurrency: string; currencies: string[] }) {
  const { t } = useLanguage();
  const { todayIso } = useFormat();
  const { pending, error, run } = useSubmit();
  const others = currencies.filter((currency) => currency !== baseCurrency);
  const [currency, setCurrency] = useState(others[0] ?? '');
  const [formKey, setFormKey] = useState(0);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        setCompanyGroupRate({
          currency: (currency || String(data.get('currency_other') ?? '')).toUpperCase(),
          rate: String(data.get('rate') ?? ''),
          effective_from: String(data.get('effective_from') ?? ''),
        }),
      t('Rate saved'),
      () => setFormKey((key) => key + 1),
    );
  }

  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_11rem_auto] sm:items-end">
        {others.length > 0 ? (
          <Field label={t('Currency')} htmlFor="rate-currency">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="rate-currency" className="font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {others.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field label={t('Currency')} htmlFor="rate-currency-other">
            <Input
              id="rate-currency-other"
              name="currency_other"
              required
              maxLength={3}
              pattern="[A-Za-z]{3}"
              className="font-mono uppercase"
            />
          </Field>
        )}
        <Field label={`${t('Rate')} (${baseCurrency})`} htmlFor="rate-value" hint={t('Value of one unit, in the group currency.')}>
          <Input
            id="rate-value"
            name="rate"
            required
            inputMode="decimal"
            pattern="\d{1,10}(\.\d{1,10})?"
            placeholder="0.0441"
            className="font-mono"
            dir="ltr"
          />
        </Field>
        <Field label={t('From')} htmlFor="rate-from">
          <Input id="rate-from" name="effective_from" type="date" required defaultValue={todayIso()} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('Save rate')}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** The company's id, for its owner to hand to a group that wants to invite it. */
export function CopyCompanyId({ id }: { id: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code dir="ltr" className="truncate rounded-btn border border-line bg-raised px-2.5 py-1.5 font-mono text-[12.5px] text-ink-soft">
        {id}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label={t('Copy company id')}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
