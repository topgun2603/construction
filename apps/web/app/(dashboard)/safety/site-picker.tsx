'use client';

import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';

/** The site a safety record is for. Hidden on a site's own tab, where it is already chosen. */
export function SitePicker({
  sites,
  value,
  onChange,
}: {
  sites: Array<{ id: string; name: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <Field label={t('Site')}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t('Choose a site')} />
        </SelectTrigger>
        <SelectContent>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A plain select over a list of `{ value, label }`, with the labels translated. */
export function OptionSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  optional,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  optional?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Field label={label} optional={optional}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder ?? t('Choose')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
