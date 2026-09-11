import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        // 15px minimum: anything smaller makes iOS zoom the viewport on focus.
        'h-10 w-full rounded-btn border border-line-strong bg-surface px-3 text-[15px] outline-none transition placeholder:text-ink-faint focus:border-accent disabled:opacity-60',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-[88px] w-full rounded-btn border border-line-strong bg-surface p-3 text-[15px] leading-relaxed outline-none transition placeholder:text-ink-faint focus:border-accent disabled:opacity-60',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Input, Textarea };
