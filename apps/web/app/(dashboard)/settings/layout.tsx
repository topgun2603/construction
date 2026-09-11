import type { ReactNode } from 'react';
import { SettingsTabs } from './settings-tabs';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <SettingsTabs />
      {children}
    </div>
  );
}
