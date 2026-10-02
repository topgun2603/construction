'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export function PrintButton() {
  const { t } = useLanguage();
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer /> {t('Print')}
    </Button>
  );
}
