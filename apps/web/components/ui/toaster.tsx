'use client';

import { Toaster as Sonner } from 'sonner';

/**
 * Toasts are a floating layer, so they are one of the few places the design
 * allows a shadow. Success uses the done colour and failure the blocked colour —
 * status colour in a pill-shaped surface, which the design permits for transient
 * feedback but not for page furniture.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'rounded-card border border-line bg-surface text-ink shadow-float text-[13.5px] font-medium',
          description: 'text-ink-muted',
          success: 'border-done/30',
          error: 'border-blocked/40',
        },
      }}
    />
  );
}
