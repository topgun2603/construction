/**
 * A ranked list of counts with a thin single-hue bar each — observations by category, actions by
 * age. One series, so no legend: the card title names it, and every row carries its number in ink,
 * so the bar is never the only way to read the value.
 */
export function CountBars({
  rows,
  emptyLabel,
}: {
  rows: Array<{ key: string; label: string; count: number }>;
  emptyLabel: string;
}) {
  const max = Math.max(0, ...rows.map((row) => row.count));
  if (max === 0) return <p className="text-[13px] text-ink-muted">{emptyLabel}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3 text-[13px]">
          <span className="truncate text-ink-soft" title={row.label}>
            {row.label}
          </span>
          <span className="h-2 rounded-full bg-raised" aria-hidden>
            <span
              className="block h-2 rounded-full bg-accent"
              style={{ width: `${row.count === 0 ? 0 : Math.max(4, (row.count / max) * 100)}%` }}
            />
          </span>
          <span className="text-end font-mono text-ink">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}
