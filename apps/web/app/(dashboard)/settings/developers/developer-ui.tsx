'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import type { ActionResult } from '@/lib/server-api';

/** Runs a server action with a pending state, an inline error and a refresh on success. */
export function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run<T>(action: () => Promise<ActionResult<T>>, success: string | null, after?: (data: T | undefined) => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      if (success) toast.success(success);
      after?.(result.data);
      router.refresh();
    });
  }
  return { pending, error, run, setError };
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-pending-fg">
      {children}
    </p>
  );
}

/**
 * A secret shown once — a new API key or signing secret — with a copy button and the warning that
 * it will not be shown again. The server keeps only a hash (keys) or an encrypted copy it never
 * sends back (signing secrets).
 */
export function SecretOnce({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-pending-line bg-pending-bg p-3">
      <span className="text-[13px] font-semibold text-pending-fg">{t('Copy this now — it will not be shown again.')}</span>
      <span className="text-[12px] font-medium text-ink-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-btn border border-line bg-surface px-2.5 py-1.5 font-mono text-[12.5px]">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('Copy')}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {t('I have copied it')}
        </Button>
      </div>
    </div>
  );
}
