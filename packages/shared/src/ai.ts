/**
 * Company-level AI controls (roadmap Phase 3, "AI data controls").
 *
 * The vocabulary the API (which enforces) and the web app (which explains) share: which AI features
 * exist, how they are grouped on the settings screen, the states a feature can be in, and the
 * regions a company may ask its model calls to be sent to.
 *
 * Everything is named `ai…` / `AI_…` so it cannot collide with the modules beside it.
 */

/**
 * The switchable groups, in the order the settings screen lists them.
 *
 * Grouped by what an owner recognises rather than by service: "reading photos and bills" is one
 * decision whether the photo is a supplier bill or a diesel slip, because the question an owner is
 * answering is "may pictures of our paperwork go to a model?".
 *
 * - `assistant`   — the "Ask" box: questions about the company's own numbers.
 * - `documents`   — asking the drawings and documents, and reading their text out to make that work.
 * - `reading`     — scanning a bill or receipt, a hour-meter photo or a fuel slip.
 * - `voice`       — turning a voice note into a daily report, snag or safety observation.
 * - `translation` — the translate panel under a bilingual text box.
 * - `suggestions` — a model's second opinion: snag and safety classification, RFI drafting, the
 *                   scope-creep check on messages and forecast wording. The keyword rules beside
 *                   each of these are not AI and keep working when this is off.
 */
export const AI_FEATURES = ['assistant', 'documents', 'reading', 'voice', 'translation', 'suggestions'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * Where a feature stands for one company, most specific reason first.
 *
 * - `on`                 — usable.
 * - `not_configured`     — this deployment has no model key. Nothing the company can change; the
 *                          screen says "not set up on this server" rather than "turned off".
 * - `off_platform`       — the operator has switched the feature off for every company.
 * - `off_company`        — the company's owner has switched it (or all AI) off.
 * - `region_unavailable` — the company chose a region this deployment has no endpoint for. Refused
 *                          rather than quietly sent to the default endpoint: a company that asked
 *                          for its data to stay in a region must not find it went elsewhere.
 */
export const AI_FEATURE_STATES = ['on', 'not_configured', 'off_platform', 'off_company', 'region_unavailable'] as const;
export type AiFeatureState = (typeof AI_FEATURE_STATES)[number];

/** Every feature's state, as `/me` and the settings screen carry it. */
export type AiFeatureStates = Record<AiFeature, AiFeatureState>;

/**
 * The region a company's model calls go to. `default` is the provider's own endpoint; the others
 * are only usable when the deployment configures a base URL for them (OPENAI_BASE_URL_EU / _US).
 */
export const AI_REGIONS = ['default', 'eu', 'us'] as const;
export type AiRegion = (typeof AI_REGIONS)[number];

/** How far back the usage table on the settings screen looks. */
export const AI_USAGE_DAYS = 30;

/**
 * The state of one feature from its inputs. Pure, so the API and its tests agree on the order the
 * reasons are checked in: a deployment with no key says so before anything else, because no setting
 * a company changes would make the feature work.
 */
export function aiFeatureState(input: {
  configured: boolean;
  platformDisabled: readonly string[];
  companyEnabled: boolean;
  companyDisabledFeatures: readonly string[];
  regionAvailable: boolean;
  feature: AiFeature;
}): AiFeatureState {
  if (!input.configured) return 'not_configured';
  if (input.platformDisabled.includes('all') || input.platformDisabled.includes(input.feature)) {
    return 'off_platform';
  }
  if (!input.companyEnabled || input.companyDisabledFeatures.includes(input.feature)) return 'off_company';
  if (!input.regionAvailable) return 'region_unavailable';
  return 'on';
}

/** All features on — what a company with no settings row, or a client outside a provider, sees. */
export function aiAllOn(): AiFeatureStates {
  return Object.fromEntries(AI_FEATURES.map((feature) => [feature, 'on'])) as AiFeatureStates;
}

/** Parses the operator's kill switch (`AI_DISABLED_FEATURES=all` or `voice,translation`). */
export function aiParseDisabledList(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item === 'all' || (AI_FEATURES as readonly string[]).includes(item));
}
