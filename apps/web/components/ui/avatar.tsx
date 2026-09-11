import { cn } from '@/lib/utils';

/**
 * Initials rather than photos. Site teams rarely have profile pictures, and a
 * two-letter monogram reads at 28px where a cropped photo does not.
 */
function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex flex-none items-center justify-center rounded-full bg-neutral-bg font-semibold text-ink-soft',
        size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-[13px]',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}

export { Avatar };
