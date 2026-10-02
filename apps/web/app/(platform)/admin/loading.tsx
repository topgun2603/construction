import { AppLoader } from '@/components/app-loader';

/** The console's wait. The tenant list and the analytics are the two that take long enough to see. */
export default function ConsoleLoading() {
  return <AppLoader label="Loading the console" />;
}
