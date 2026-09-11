import { redirect } from 'next/navigation';
import { homePathFor, loadSelf } from '@/lib/session';
import { HeroPanel } from './hero-panel';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · BUILDR' };

export default async function LoginPage() {
  // Already signed in: skip the form rather than making them authenticate twice.
  const self = await loadSelf();
  if (self) redirect(homePathFor(self.permissions));

  return (
    // A two-column split at lg and above; below that the dark panel is dropped
    // entirely rather than stacked — a supervisor signing in on a phone wants the
    // keyboard, not a scroll past the marketing.
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <HeroPanel />
      <LoginForm />
    </main>
  );
}
