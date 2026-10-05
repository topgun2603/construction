'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

/** "Save as PDF" is the browser's print dialog; nothing is generated on the server. */
export function PrintButton() {
  const { t } = useLanguage();
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer /> {t('Print or save as PDF')}
    </Button>
  );
}
