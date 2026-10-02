import { AppLoader } from '@/components/app-loader';
import { getT } from '@/lib/i18n-server';

/**
 * Shown while any dashboard route resolves on the server.
 *
 * Next renders this the moment a navigation starts, which is why the loader holds itself invisible
 * for the first 400ms — most of these finish before anybody should see anything at all.
 */
export default async function DashboardLoading() {
  const t = await getT();
  return <AppLoader label={t('Loading this screen')} />;
}
