import { PlatformLoginForm } from './platform-login-form';
import { ConsoleStage } from './console-stage';

export const metadata = { title: 'Platform sign in · BUILDR' };

/**
 * The console door.
 *
 * Full bleed and dark, with no header — there is no session to navigate with, and the chrome that
 * used to show here offered Overview, Tenants and Sign out to somebody who was signed out.
 *
 * Deliberately *not* the tenant login. Both are dark and typographic so they are recognisably one
 * product, but this one states what the console can do to other people's accounts rather than what
 * the product does for you. An operator should feel the weight of the room they are entering, and a
 * stranger who finds the URL should understand immediately that it is not for them.
 */
export default function PlatformLoginPage() {
  return (
    <ConsoleStage>
      <PlatformLoginForm />
    </ConsoleStage>
  );
}
