import { AppLoader } from '@/components/app-loader';
import { getT } from '@/lib/i18n-server';

/**
 * The outermost wait: the first paint of a cold navigation, before a layout has decided which
 * shell this page belongs in. Full height, because there is no chrome around it yet.
 */
export default async function RootLoading() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas">
      <AppLoader label={t('Loading BUILDR')} />
    </main>
  );
}
