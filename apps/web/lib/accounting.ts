import type { AccountingAccount } from '@sitebook/shared';

/** What the grid holds for one key while it is being edited. */
export type AccountingDraft = Record<string, AccountingAccount>;

/**
 * The rows to send when the grid is saved: only those that changed, so an untouched row is not
 * rewritten (and not audited) — and a row cleared to nothing is sent with an empty name, which is
 * how the API is told to remove it. Whitespace is trimmed the way the API trims it, so a stray
 * space is not a change.
 */
export function changedAccountingRows(
  saved: Readonly<Record<string, AccountingAccount | null>>,
  draft: Readonly<AccountingDraft>,
): { key: string; code: string; name: string }[] {
  const out: { key: string; code: string; name: string }[] = [];
  for (const [key, value] of Object.entries(draft)) {
    const code = value.code.trim();
    const name = value.name.trim();
    const before = saved[key];
    const beforeCode = before?.code.trim() ?? '';
    const beforeName = before?.name.trim() ?? '';
    if (code === beforeCode && name === beforeName) continue;
    // Clearing a row that was never saved is no change at all.
    if (!name && !beforeName) continue;
    out.push({ key, code: name ? code : '', name });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** `1048576` → `1.0 MB`, for the file list. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
