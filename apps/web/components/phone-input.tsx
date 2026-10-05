'use client';

import { useState } from 'react';
import {
  AE,
  BD,
  BH,
  IN,
  KW,
  LK,
  NP,
  OM,
  QA,
  SA,
  type FlagComponent,
} from 'country-flag-icons/react/3x2';
import { PHONE_COUNTRIES, phoneCountry, presetFor } from '@sitebook/shared';
import { cn } from '@/lib/utils';
import { useFormat } from '@/components/format-provider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * SVG flags rather than emoji. Windows draws no flag emoji at all — Chrome and Edge there show 🇦🇪
 * as the letters "AE" — and that is the desk most owners sign in from. Imported one by one so only
 * these ten reach the bundle.
 */
const FLAGS: Record<string, FlagComponent> = {
  IN,
  AE,
  SA,
  QA,
  KW,
  OM,
  BH,
  LK,
  BD,
  NP,
};

export function CountryFlag({ country, className }: { country: string; className?: string }) {
  const Flag = FLAGS[country];
  if (!Flag) return null;
  return (
    <Flag
      aria-hidden
      className={cn(
        'h-[14px] w-[21px] flex-none rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0/0.08)]',
        className,
      )}
    />
  );
}

/**
 * The calling-code picker that sits in front of a phone field: the flag and `+971` closed, the
 * flag, country and code in the list. The code is what people recognise; the flag tells +965 from
 * +966 at a glance, which a code alone does not.
 */
export function CallingCodeSelect({
  value,
  onChange,
  className,
  id,
}: {
  value: string;
  onChange: (country: string) => void;
  className?: string;
  id?: string;
}) {
  const selected = phoneCountry(value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        aria-label="Country code"
        className={cn(
          'h-full w-auto flex-none gap-1.5 rounded-none border-0 border-r border-line bg-transparent px-3 font-mono text-[14px] text-ink-muted',
          className,
        )}
      >
        <SelectValue>
          <span className="flex items-center gap-2">
            <CountryFlag country={value} />+{selected?.callingCode}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[15rem]">
        {PHONE_COUNTRIES.map((entry) => (
          <SelectItem key={entry.country} value={entry.country}>
            <span className="flex w-full items-center gap-2.5">
              <CountryFlag country={entry.country} />
              <span className="flex-1">{presetFor(entry.country)?.name ?? entry.country}</span>
              <span className="font-mono text-[13px] text-ink-muted">+{entry.callingCode}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A mobile number field for forms that post through `FormData`.
 *
 * Defaults to the company's country. What it submits under `name` is the number with its `+code`
 * — `+971501234567` — never bare national digits, because the API reads bare digits as Indian and a
 * Nepali mobile is a valid Indian one too. Empty when nothing is typed, so optional fields stay
 * optional.
 */
export function PhoneInput({
  name,
  id,
  required,
  defaultCountry,
}: {
  name: string;
  id?: string;
  required?: boolean;
  defaultCountry?: string;
}) {
  const { settings } = useFormat();
  const [country, setCountry] = useState(
    defaultCountry ?? (phoneCountry(settings.country ?? '') ? settings.country! : 'IN'),
  );
  const [digits, setDigits] = useState('');
  const entry = phoneCountry(country);
  const typed = digits.trim();
  // Somebody pasting "+971 50…" has given the code already; it wins over the picker.
  const value =
    typed === '' ? '' : typed.startsWith('+') ? typed : `+${entry?.callingCode ?? ''}${typed}`;

  return (
    <div className="flex h-10 items-stretch overflow-hidden rounded-btn border border-line-strong bg-surface transition focus-within:border-accent">
      <CallingCodeSelect value={country} onChange={setCountry} />
      <input
        id={id}
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        placeholder={entry?.example}
        value={digits}
        onChange={(event) => setDigits(event.target.value)}
        className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[15px] outline-none placeholder:font-sans placeholder:text-ink-faint"
      />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
