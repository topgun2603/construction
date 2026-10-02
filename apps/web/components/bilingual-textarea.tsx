'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Languages, Loader2 } from 'lucide-react';
import { APP_LANGUAGES, type LanguageCode } from '@sitebook/shared';
import { translateText } from '@/lib/actions';
import { Textarea } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';

/**
 * A text field that types in one language and files in another.
 *
 * The project manager in the office types English. The supervisor who has to act on the
 * instruction, and the client's family reading the progress note, read Tamil. Today that gap is
 * closed by somebody pasting into another tab, or — far more often — not closed at all: the note
 * goes out in English and the person it was written for does not read it.
 *
 * So the field closes it. English in, the Tamil appears underneath as you pause, and one tap files
 * the Tamil instead.
 *
 * **One tap, not zero.** The translation is never swapped in by itself, and that is not timidity:
 * "pour the slab tomorrow" rendered slightly wrong is an instruction going to a site, and the
 * person sending it is the only one who can tell. Showing it and waiting is the difference between
 * a tool and a liability.
 */
export function BilingualTextarea({
  id,
  name,
  defaultValue = '',
  rows = 4,
  maxLength,
  placeholder,
  required,
  /** What to translate into. Defaults to whatever language the interface is set to. */
  into,
  value: controlled,
  onChange,
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
  into?: LanguageCode;
  /**
   * Controlled, for the forms that already hold their own text — the site conversation posts
   * through an action rather than a form submit, so it owns the value and this follows.
   */
  value?: string;
  onChange?: (next: string) => void;
}) {
  const { language, t } = useLanguage();
  // Translating into the language you are already writing in is nothing; English is the fallback
  // target so somebody working in a Tamil interface can still produce an English note.
  const target = into ?? (language === 'en' ? 'ta' : language);

  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;
  const setValue = onChange ?? setOwn;
  const [draft, setDraft] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  // Which text the current draft is a translation *of*, so a stale answer that arrives after the
  // next keystroke is discarded rather than shown against text it does not match.
  const asked = useRef('');

  useEffect(() => {
    const text = value.trim();
    setFailed(false);

    // Under this it is a word, and a word has no context to translate from — asking on every
    // keystroke of "sl" would be noise with a price.
    if (text.length < 12 || looksTranslated(text, target)) {
      setDraft(null);
      return;
    }

    /*
     * 900ms after the last keystroke.
     *
     * Long enough that typing a sentence is one call rather than thirty, short enough that it
     * appears while somebody is still looking at the field rather than after they have moved on.
     */
    const timer = setTimeout(async () => {
      asked.current = text;
      setWorking(true);
      const result = await translateText({ text, to: target });
      setWorking(false);

      if (asked.current !== text) return;
      if (!result.ok || !result.data) {
        setFailed(true);
        setDraft(null);
        return;
      }
      // A vendor that hands back what it was given has told us the text was already in the target
      // language; offering it as a translation would be absurd.
      setDraft(result.data.text.trim() === text ? null : result.data.text);
    }, 900);

    return () => clearTimeout(timer);
  }, [value, target]);

  const targetName = APP_LANGUAGES.find((entry) => entry.code === target);

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />

      {working && (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <Loader2 className="size-3 animate-spin" />
          {t('Translating')} · {targetName?.native ?? target}
        </p>
      )}

      {failed && (
        <p className="text-[12px] text-ink-muted">
          {t('Could not translate that just now — what you typed is unchanged.')}
        </p>
      )}

      {draft && !working && (
        <div className="flex flex-col gap-1.5 rounded-panel border border-line bg-raised p-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            <Languages className="size-3" />
            {targetName?.native ?? target}
          </span>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{draft}</p>
          <button
            type="button"
            onClick={() => {
              setValue(draft);
              setDraft(null);
            }}
            className="self-start rounded-btn px-2 py-1 text-[12px] font-medium text-accent transition hover:bg-accent-soft"
          >
            <Check className="mr-1 inline size-3" />
            {t('Use this')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Is this text already in the target language?
 *
 * By script, which for these languages is exact and free. Tamil, Telugu, Kannada, Malayalam and
 * Devanagari each occupy their own Unicode block, so one character settles it — and asking a vendor
 * to translate Tamil into Tamil on every pause would be a charge for nothing.
 *
 * English is the case this cannot answer, since English and romanised Tamil share an alphabet. It
 * returns false there and lets the vendor's own "already in that language" answer handle it.
 */
function looksTranslated(text: string, target: LanguageCode): boolean {
  const blocks: Partial<Record<LanguageCode, RegExp>> = {
    ta: /[஀-௿]/,
    te: /[ఀ-౿]/,
    kn: /[ಀ-೿]/,
    ml: /[ഀ-ൿ]/,
    hi: /[ऀ-ॿ]/,
  };
  const block = blocks[target];
  return block ? block.test(text) : false;
}
