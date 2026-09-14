import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch, ApiRequestError, type ApiFetchOptions } from './api';

/**
 * The platform console's session, kept entirely separate from a tenant's.
 *
 * A different cookie name, a different token audience, and a different sign-in route.
 * An operator who also happens to own a BUILDR account can be signed into both at
 * once without either session being usable as the other — which is the point: the
 * console's token is not a privileged tenant session, it is a different kind of thing.
 */
export const PLATFORM_COOKIE = 'sb_platform';

export async function platformToken(): Promise<string | null> {
  return (await cookies()).get(PLATFORM_COOKIE)?.value ?? null;
}

/**
 * Call a console endpoint as the operator.
 *
 * Any refusal sends them back to the console's own login, never the tenant one —
 * landing an operator on /login would have them sign in and arrive at somebody's
 * dashboard, or more likely at an onboarding form.
 */
export async function platformFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const token = await platformToken();
  if (!token) redirect('/admin/login');

  try {
    return await apiFetch<T>(`/admin${path}`, { ...options, accessToken: token });
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      redirect('/admin/login');
    }
    throw error;
  }
}

export interface PlatformMetrics {
  revenue: {
    /** Paise per month, counting only subscriptions actually being charged. */
    mrr: string;
    paying: number;
    trialing: number;
    past_due: number;
  };
  tenants: {
    total: number;
    active: number;
    suspended: number;
    cancelled: number;
    new_this_month: number;
  };
  plans: { starter: number; pro: number };
  usage: { users: number; projects: number; active_projects: number; workers: number };
}

export interface PlatformTenantRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  enabled_modules: string[];
  created_at: string;
  owner_name: string | null;
  owner_phone: string | null;
  user_count: number;
  project_count: number;
  worker_count: number;
  last_activity: string | null;
  plan_expires_on: string | null;
  plan_standing: 'active' | 'grace' | 'expired';
}

export interface PlatformTenantDetail {
  tenant: {
    id: string;
    name: string;
    logo_url: string | null;
    plan: string;
    status: string;
    enabled_modules: string[];
    created_at: string;
    plan_started_on: string | null;
    plan_expires_on: string | null;
    plan_standing: 'active' | 'grace' | 'expired';
    razorpay_customer_id: string | null;
  };
  usage: { workers: number; attendance_rows: number; reports: number; expenses: number };
  team: Array<{
    id: string;
    name: string;
    phone: string;
    role: string;
    status: string;
    last_login: string | null;
  }>;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    start_date: string | null;
    budget_amount: string | null;
  }>;
  audit: Array<{
    id: string;
    actor_phone: string;
    action: string;
    before: unknown;
    after: unknown;
    created_at: string;
  }>;
}

export interface PlatformAnalytics {
  weeks: number;
  signups: Array<{ week: string; count: number; cumulative: number }>;
  funnel: Array<{
    key: string;
    label: string;
    count: number;
    percent: number;
    dropped: number;
  }>;
  /**
   * Tenants with more than one login, reported beside the funnel rather than inside it — working
   * alone is not dropping out of anything.
   */
  invited: number;
  activity: Array<{ week: string; active: number; existing: number; percent: number }>;
  volume: Array<{ day: string; attendance: number; reports: number; expenses: number }>;
  dormant: Array<{
    id: string;
    name: string;
    plan: string;
    created_at: string;
    last_work: string | null;
    /** null when the tenant has never recorded any work at all. */
    quiet_days: number | null;
  }>;
  leaders: Array<{
    id: string;
    name: string;
    plan: string;
    attendance: number;
    reports: number;
  }>;
  plan_mix: Array<{
    week: string;
    three_months: number;
    six_months: number;
    one_year: number;
    lifetime: number;
  }>;
}
