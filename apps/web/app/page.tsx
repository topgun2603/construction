import { redirect } from 'next/navigation';
import { homePathFor, loadSelf } from '@/lib/session';

export default async function RootPage() {
  const self = await loadSelf();
  redirect(self ? homePathFor(self.permissions) : '/login');
}
