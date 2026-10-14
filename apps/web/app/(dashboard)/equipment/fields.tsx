'use client';

import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';

/**
 * A select over `{ value, label }` options for the equipment forms. Labels are English keys and
 * are translated here; names (sites, vendors, workers) pass `translate={false}`.
 */
export function ChoiceField({
  label,
  value,
  onChange,
  options,
  placeholder,
  optional,
  translate = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  optional?: boolean;
  translate?: boolean;
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
              {translate ? t(option.label) : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A labelled checkbox row. */
export function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13.5px]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
