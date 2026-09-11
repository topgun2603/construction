import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting a caller's utility win over a component's default.
 *
 * `clsx` flattens conditionals; `twMerge` then resolves Tailwind conflicts, so
 * `cn('px-4', 'px-6')` yields `px-6` rather than two competing classes. This is what
 * makes the `className` prop on every component below actually able to override.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
