import { cn } from '@/lib/utils';

/** Placeholder while a Suspense boundary resolves. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-btn bg-neutral-bg', className)} {...props} />;
}

export { Skeleton };
