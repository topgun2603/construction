import { AppLoader } from '@/components/app-loader';

/**
 * The outermost wait: the first paint of a cold navigation, before a layout has decided which
 * shell this page belongs in. Full height, because there is no chrome around it yet.
 */
export default function RootLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas">
      <AppLoader label="Loading BUILDR" />
    </main>
  );
}
