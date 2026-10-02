import { AppLoader } from '@/components/app-loader';

/**
 * Shown while any dashboard route resolves on the server.
 *
 * Next renders this the moment a navigation starts, which is why the loader holds itself invisible
 * for the first 400ms — most of these finish before anybody should see anything at all.
 */
export default function DashboardLoading() {
  return <AppLoader label="Loading this screen" />;
}
