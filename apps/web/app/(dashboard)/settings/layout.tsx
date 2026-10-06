import type { ReactNode } from 'react';
import { requireSelf } from '@/lib/session';
import { SettingsTabs } from './settings-tabs';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // Cached per request, so the page below reading it too costs nothing more.
  const me = await requireSelf();
  return (
    <div className="flex flex-col gap-5">
      <SettingsTabs permissions={me.permissions} role={me.user.role} />
      {children}
    </div>
  );
}
