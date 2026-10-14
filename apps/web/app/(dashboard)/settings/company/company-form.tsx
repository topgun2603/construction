'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { COUNTRY_PRESETS, localesFor, presetFor, TAX_REGIMES } from '@sitebook/shared';
import type { CompanySettings } from '@/lib/api-types';
import { updateCompanySettings } from '@/lib/actions';
import { createFormat } from '@/lib/format';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TAX_LABELS: Record<(typeof TAX_REGIMES)[number], string> = {
  gst_in: 'GST (India)',
  vat_ae: 'VAT 5% (UAE)',
  vat_sa: 'VAT 15% (Saudi Arabia)',
  none: 'None yet',
};

/** A sample big enough to show grouping: 12,34,567.89 in India, 1,234,567.89 elsewhere. */
const SAMPLE_MINOR = '123456789';
/**
 * Fixed rather than "now": this renders on the server and again in the browser, and a clock that
 * ticked over between the two would be a hydration mismatch. 04:30 UTC is 10:00 in Kolkata and
 * 08:30 in Dubai, so a zone change visibly moves it.
 */
const SAMPLE_DATE = '2026-03-02';
const SAMPLE_INSTANT = '2026-03-02T04:30:00Z';

type Settings = Pick<
  CompanySettings,
  'country' | 'currency' | 'timezone' | 'locale' | 'tax_regime'
>;

/**
 * The company's locale settings.
 *
 * Choosing a country fills the other four from its preset, because that is nearly always what is
 * wanted — a UAE company works in dirhams, on Dubai time, under UAE VAT. Each can still be set on
 * its own afterwards, for the company in Sharjah that wants its documents in Arabic.
 *
 * The preview prints a real amount and date through the same `createFormat` the rest of the app
 * uses, so what it shows is exactly what every page will show after saving.
 */
export function CompanyForm({ company, canEdit }: { company: CompanySettings; canEdit: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({
    country: company.country,
    currency: company.currency,
    timezone: company.timezone,
    locale: company.locale,
    tax_regime: company.tax_regime,
  });
  // UAE WPS ids, kept apart from the locale settings the preview formats with.
  const [wps, setWps] = useState({
    employer: company.wps_employer_id ?? '',
    bank: company.wps_bank_code ?? '',
  });

  // Saudi WPS (Mudad): the MHRSD establishment number on every payroll file.
  const [establishment, setEstablishment] = useState(company.mudad_establishment_id ?? '');

  const locked = company.currency_locked;
  const uae = settings.country === 'AE';
  const saudi = settings.country === 'SA';
  const changed =
    (Object.keys(settings) as (keyof Settings)[]).some((key) => settings[key] !== company[key]) ||
    (uae &&
      (wps.employer.trim() !== (company.wps_employer_id ?? '') ||
        wps.bank.trim() !== (company.wps_bank_code ?? ''))) ||
    (saudi && establishment.trim() !== (company.mudad_establishment_id ?? ''));

  const options = useMemo(() => {
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });
    const withCurrent = (list: string[], current: string) =>
      list.includes(current) ? list : [current, ...list];

    const countries = withCurrent(
      COUNTRY_PRESETS.map((preset) => preset.country),
      settings.country,
    ).map((code) => ({
      value: code,
      label: presetFor(code)?.name ?? regionNames.of(code) ?? code,
    }));

    const currencies = withCurrent(
      [...new Set(COUNTRY_PRESETS.map((preset) => preset.currency))],
      settings.currency,
    ).map((code) => ({ value: code, label: `${code} — ${currencyNames.of(code) ?? code}` }));

    const locales = withCurrent(localesFor(settings.country), settings.locale).map((tag) => ({
      value: tag,
      label: languageNames.of(tag) ?? tag,
    }));

    // Every zone the browser knows, so a company in a country without a preset is not stuck.
    const timezones = withCurrent(Intl.supportedValuesOf('timeZone'), settings.timezone);

    return { countries, currencies, locales, timezones };
  }, [settings.country, settings.currency, settings.locale, settings.timezone]);

  const preview = useMemo(() => {
    const format = createFormat(settings);
    return {
      money: format.money(SAMPLE_MINOR),
      short: format.moneyShort('4200000000'),
      date: format.longDate(SAMPLE_DATE),
      time: format.timeOfDay(SAMPLE_INSTANT),
    };
  }, [settings]);

  function pickCountry(country: string) {
    const preset = presetFor(country);
    setSettings((current) =>
      preset
        ? {
            country,
            // A locked currency stays; everything else follows the country.
            currency: locked ? current.currency : preset.currency,
            timezone: preset.timezone,
            locale: preset.locale,
            tax_regime: preset.taxRegime,
          }
        : { ...current, country },
    );
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await updateCompanySettings({
        ...settings,
        // Sent only for a UAE company; a blank field clears the id.
        ...(uae
          ? { wps_employer_id: wps.employer.trim() || null, wps_bank_code: wps.bank.trim() || null }
          : {}),
        // Sent only for a Saudi company; blank clears it.
        ...(saudi ? { mudad_establishment_id: establishment.trim() || null } : {}),
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not save'));
        return;
      }
      toast.success(t('Company settings saved'));
      router.refresh();
    });
  }

  const set = (key: keyof Settings) => (value: string) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <Card className="flex max-w-2xl flex-col gap-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Country')} htmlFor="country">
          <Select value={settings.country} onValueChange={pickCountry} disabled={!canEdit}>
            <SelectTrigger id="country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.countries.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={t('Currency')}
          htmlFor="currency"
          hint={
            locked
              ? t(
                  'Fixed once sites, workers or payments are recorded — every amount is stored in it.',
                )
              : undefined
          }
        >
          <Select
            value={settings.currency}
            onValueChange={set('currency')}
            disabled={!canEdit || locked}
          >
            <SelectTrigger id="currency">
              <span className="flex items-center gap-2 truncate">
                {locked && <Lock className="size-3.5 flex-none text-ink-muted" />}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {options.currencies.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('Time zone')} htmlFor="timezone">
          <Select value={settings.timezone} onValueChange={set('timezone')} disabled={!canEdit}>
            <SelectTrigger id="timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.timezones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('Numbers and dates')} htmlFor="locale">
          <Select value={settings.locale} onValueChange={set('locale')} disabled={!canEdit}>
            <SelectTrigger id="locale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.locales.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('Tax')} htmlFor="tax_regime">
          <Select value={settings.tax_regime} onValueChange={set('tax_regime')} disabled={!canEdit}>
            <SelectTrigger id="tax_regime">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAX_REGIMES.map((regime) => (
                <SelectItem key={regime} value={regime}>
                  {t(TAX_LABELS[regime])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {uae && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('WPS salary files')}
            </span>
            <span className="text-[13px] text-ink-muted">
              {t('Printed on every salary file you hand to the bank. Both are needed to make one.')}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('MOL establishment id')}
              htmlFor="wps_employer_id"
              optional
              hint={t('13 digits')}
            >
              <Input
                id="wps_employer_id"
                inputMode="numeric"
                pattern="[0-9]{13}"
                maxLength={13}
                value={wps.employer}
                onChange={(event) => setWps((current) => ({ ...current, employer: event.target.value }))}
                disabled={!canEdit}
              />
            </Field>
            <Field
              label={t('Paying bank routing code')}
              htmlFor="wps_bank_code"
              optional
              hint={t('9 digits')}
            >
              <Input
                id="wps_bank_code"
                inputMode="numeric"
                pattern="[0-9]{9}"
                maxLength={9}
                value={wps.bank}
                onChange={(event) => setWps((current) => ({ ...current, bank: event.target.value }))}
                disabled={!canEdit}
              />
            </Field>
          </div>
        </div>
      )}

      {saudi && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Mudad payroll files')}
            </span>
            <span className="text-[13px] text-ink-muted">
              {t('Printed on every payroll file you upload to Mudad or your bank.')}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('MHRSD establishment number')}
              htmlFor="mudad_establishment_id"
              optional
              hint={t('Labour office and sequence, like 1-123456')}
            >
              <Input
                id="mudad_establishment_id"
                dir="ltr"
                inputMode="numeric"
                pattern="[0-9]{1,3}-[0-9]{1,10}"
                maxLength={14}
                value={establishment}
                onChange={(event) => setEstablishment(event.target.value)}
                disabled={!canEdit}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-btn bg-canvas px-4 py-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {t('Preview')}
        </span>
        <span className="font-mono text-[15px]">
          {preview.money} · {preview.short}
        </span>
        <span className="text-[13.5px] text-ink-muted">
          {preview.date} · {preview.time}
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-btn border border-blocked/30 bg-blocked-bg px-3.5 py-2.5 text-[13.5px] text-blocked-fg"
        >
          {error}
        </p>
      )}

      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={!changed || pending}>
            {pending ? t('Saving…') : t('Save')}
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">
          {t('Only somebody who can change company details can edit these.')}
        </p>
      )}
    </Card>
  );
}
