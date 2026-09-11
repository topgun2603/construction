import { MODULES as SHARED_MODULES } from '@sitebook/shared';

/**
 * The gateable modules, for the console's toggle row.
 *
 * Imported from shared rather than listed again here: the API validates against the same
 * constant, so a module added there appears in this console automatically instead of being
 * silently un-toggleable until somebody remembers this file.
 */
export const MODULES: readonly string[] = SHARED_MODULES;

/** Names that do not read well from the enum value alone. */
const LABELS: Record<string, string> = {
  dpr: 'Daily reports',
  client_portal: 'Client portal',
};

export function moduleLabel(name: string): string {
  return LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');
}
