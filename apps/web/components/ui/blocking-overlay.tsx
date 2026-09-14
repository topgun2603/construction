'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

/**
 * A full-screen wait, for the few actions that end the page they were started from.
 *
 * Sign-out is the case this exists for. It revokes every session on the server and then
 * redirects, which on a slow connection is a second or two of a dashboard that still looks
 * live — so somebody clicks sign out again, or opens a site while the revoke is in flight.
 * Both are confusing rather than harmful, and both are avoided by saying plainly that
 * something is happening and taking the rest of the page out of reach until it has.
 *
 * Deliberately not a dialog: there is nothing to decide and nothing to dismiss. It is a
 * curtain, so it has no close button, swallows Escape, and does not trap focus for
 * navigation — it just blocks and announces.
 */
export function BlockingOverlay({ open, label }: { open: boolean; label: string }) {
  // Escape would otherwise reach whatever is underneath — a dialog that was open when this
  // started, say — and close it behind the curtain.
  useEffect(() => {
    if (!open) return;
    const swallow = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.stopPropagation();
    };
    document.addEventListener('keydown', swallow, true);
    return () => document.removeEventListener('keydown', swallow, true);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          // `status` rather than `alertdialog`: a screen reader should hear it without being
          // asked to answer anything.
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-canvas/60 backdrop-blur-sm"
          // Every pointer event stops here, which is the whole point.
          onPointerDownCapture={(event) => event.preventDefault()}
        >
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-float">
            <Loader2 className="size-4 animate-spin text-accent" />
            <span className="text-[14px] font-medium">{label}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
