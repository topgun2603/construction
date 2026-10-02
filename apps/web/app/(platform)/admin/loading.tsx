import { AppLoader } from '@/components/app-loader';
import { getT } from '@/lib/i18n-server';

/** The console's wait. The tenant list and the analytics are the two that take long enough to see. */
export default async function ConsoleLoading() {
  const t = await getT();
  return <AppLoader label={t('Loading the console')} />;
}
