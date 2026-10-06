import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import {
  AI_FEATURES,
  AI_REGIONS,
  ERROR_CODES,
  aiFeatureState,
  aiParseDisabledList,
  type AiFeature,
  type AiFeatureState,
  type AiFeatureStates,
  type AiRegion,
} from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';

/**
 * The model client every AI feature uses. A type alias rather than the vendor's class name so that
 * a service never needs to import from `openai` itself — `ai-gateway.spec.ts` fails the build if
 * one does.
 */
export type AiModelClient = OpenAI;

/** The vendor's upload helper, re-exported for the voice reader for the same reason. */
export const aiToFile = toFile;

/** One company's stored AI settings, or the defaults when it has never saved any. */
export interface AiCompanySettings {
  enabled: boolean;
  disabledFeatures: string[];
  region: AiRegion;
  updatedAt: Date | null;
}

const DEFAULTS: AiCompanySettings = { enabled: true, disabledFeatures: [], region: 'default', updatedAt: null };

/**
 * The one door to the model vendor.
 *
 * Every AI feature asks this for its client with `client(tenantId, feature)`, and that call is where
 * all of the company-level controls live: the deployment has a key, the operator has not switched
 * the feature off for everybody, the company has not switched it (or all AI) off, its chosen region
 * has an endpoint — and only then is the call counted and a client for that region handed back.
 *
 * One door on purpose. A check that every service must remember to make is a check the next
 * service forgets; a client that can only be had through the check cannot be used without it.
 * `ai-gateway.spec.ts` scans the source tree and fails if anything else imports the vendor SDK.
 *
 * Soft paths — the keyword rules beside snag, safety and scope-creep suggestions, the forecast's
 * template sentence — ask `isOn` first and fall back quietly; nothing that is not a model call is
 * ever switched off by this.
 */
@Injectable()
export class AiGateway {
  private readonly logger = new Logger(AiGateway.name);
  private readonly config = env();
  private readonly clients = new Map<string, AiModelClient>();

  /**
   * Settings per company, briefly. Read on every model call and on every `/me`, and changed a few
   * times a year — but kept no longer than the tenant cache, so a switch flipped on another
   * instance takes effect on this one within the same window as every other company setting.
   */
  private readonly cache = new Map<string, { at: number; settings: AiCompanySettings }>();

  constructor(private readonly tenantDb: TenantDb) {}

  /** Whether this deployment can call a model at all. Distinct from any company's choice. */
  get configured(): boolean {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  /** The operator's kill switch (`AI_DISABLED_FEATURES`), parsed. */
  platformDisabled(): string[] {
    return aiParseDisabledList(this.config.AI_DISABLED_FEATURES);
  }

  /** The base URL each region sends to; `undefined` for `default` means the vendor's own endpoint. */
  regionEndpoints(): Record<AiRegion, string | undefined> {
    return {
      default: this.config.OPENAI_BASE_URL,
      eu: this.config.OPENAI_BASE_URL_EU,
      us: this.config.OPENAI_BASE_URL_US,
    };
  }

  /** Which regions a company may choose here. The default always; the others only when configured. */
  regionAvailability(): Record<AiRegion, boolean> {
    const endpoints = this.regionEndpoints();
    return Object.fromEntries(
      AI_REGIONS.map((region) => [region, region === 'default' || Boolean(endpoints[region])]),
    ) as Record<AiRegion, boolean>;
  }

  async settingsOf(tenantId: string): Promise<AiCompanySettings> {
    const ttl = this.config.TENANT_CACHE_TTL_SECONDS * 1000;
    const hit = this.cache.get(tenantId);
    if (hit && ttl > 0 && Date.now() - hit.at < ttl) return hit.settings;

    const row = await this.tenantDb
      .clientFor(tenantId)
      .aiSettings.findUnique({ where: { tenantId } });
    const settings: AiCompanySettings = row
      ? {
          enabled: row.enabled,
          disabledFeatures: row.disabledFeatures,
          region: (AI_REGIONS as readonly string[]).includes(row.region) ? (row.region as AiRegion) : 'default',
          updatedAt: row.updatedAt,
        }
      : DEFAULTS;
    this.cache.set(tenantId, { at: Date.now(), settings });
    return settings;
  }

  /** Dropped after a save, so the owner who just switched something off sees it off at once. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  async states(tenantId: string): Promise<AiFeatureStates> {
    const settings = await this.settingsOf(tenantId);
    return Object.fromEntries(
      AI_FEATURES.map((feature) => [feature, this.stateFrom(settings, feature)]),
    ) as AiFeatureStates;
  }

  async state(tenantId: string, feature: AiFeature): Promise<AiFeatureState> {
    return this.stateFrom(await this.settingsOf(tenantId), feature);
  }

  /** For soft paths: "may I ask a model?" with no error, so the caller can fall back to its rules. */
  async isOn(tenantId: string, feature: AiFeature): Promise<boolean> {
    return (await this.state(tenantId, feature)) === 'on';
  }

  /**
   * Whether documents may be read into searchable pages (`document_chunks`) for this company.
   *
   * Reading the text out is done here, not by a model — but it exists only so the documents can be
   * asked, and a company that switched Documents off has said it does not want that index built.
   * A deployment with no key keeps indexing, as it always has: the index is ready the day a key is
   * added, and nothing leaves the server either way.
   */
  async documentIndexingAllowed(tenantId: string): Promise<boolean> {
    // Read from the switches themselves rather than `state`: with no key the state is
    // `not_configured` whatever the company chose, and a company's "off" must still stop the index.
    const platform = this.platformDisabled();
    if (platform.includes('all') || platform.includes('documents')) return false;
    const settings = await this.settingsOf(tenantId);
    return settings.enabled && !settings.disabledFeatures.includes('documents');
  }

  /**
   * Throws unless the feature may be used. `notConfigured` keeps each feature's own wording for the
   * deployment-has-no-key case ("Bill scanning is not configured on this deployment"), which the
   * screens already show.
   */
  async assertEnabled(tenantId: string, feature: AiFeature, notConfigured?: string): Promise<void> {
    const state = await this.state(tenantId, feature);
    if (state === 'on') return;
    throw refusal(feature, state, notConfigured);
  }

  /**
   * The client for one model call: checked, counted, and pointed at the company's region.
   *
   * Counted here rather than after the call returns, so the number is "calls sent", which is what
   * the vendor bills and what a company auditing its own switch wants to see. A failed count is
   * logged and ignored — usage is for information, and must never be why a feature fails.
   */
  async client(tenantId: string, feature: AiFeature, notConfigured?: string): Promise<AiModelClient> {
    const settings = await this.settingsOf(tenantId);
    const state = this.stateFrom(settings, feature);
    if (state !== 'on') throw refusal(feature, state, notConfigured);

    await this.count(tenantId, feature);
    return this.clientFor(this.regionEndpoints()[settings.region]);
  }

  private stateFrom(settings: AiCompanySettings, feature: AiFeature): AiFeatureState {
    return aiFeatureState({
      configured: this.configured,
      platformDisabled: this.platformDisabled(),
      companyEnabled: settings.enabled,
      companyDisabledFeatures: settings.disabledFeatures,
      regionAvailable: this.regionAvailability()[settings.region],
      feature,
    });
  }

  private async count(tenantId: string, feature: AiFeature): Promise<void> {
    try {
      // Raw SQL inside `transaction`, which sets `app.tenant_id` for RLS: an upsert that adds one
      // is a single statement this way, where Prisma's `upsert` would be a read and a write that
      // two concurrent calls could interleave and lose a count between.
      await this.tenantDb.transaction(tenantId, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO ai_usage_daily (tenant_id, day, feature, calls)
          VALUES (${tenantId}::uuid, (now() AT TIME ZONE 'UTC')::date, ${feature}, 1)
          ON CONFLICT (tenant_id, day, feature)
          DO UPDATE SET calls = ai_usage_daily.calls + 1`;
      });
    } catch (error) {
      this.logger.warn({ err: error, feature }, 'Could not count an AI call');
    }
  }

  private clientFor(baseURL: string | undefined): AiModelClient {
    const key = baseURL ?? '';
    let client = this.clients.get(key);
    if (!client) {
      client = this.createClient(baseURL);
      this.clients.set(key, client);
    }
    return client;
  }

  /** The only `new OpenAI(...)` in the codebase. Protected so the e2e suite can hand back a fake. */
  protected createClient(baseURL: string | undefined): AiModelClient {
    return new OpenAI({ apiKey: this.config.OPENAI_API_KEY, ...(baseURL ? { baseURL } : {}) });
  }
}

/**
 * Why a feature cannot be used, as the error a client branches on.
 *
 * No key is 409 `CONFLICT`, as it always was (the existing screens show "not configured"), with
 * `details.ai = 'not_configured'` so it can be told apart without reading the message. Anything a
 * person decided — the operator, the company, or a region choice — is 403 `AI_DISABLED`.
 */
function refusal(feature: AiFeature, state: AiFeatureState, notConfigured?: string): ApiError {
  if (state === 'not_configured') {
    return ApiError.conflict(notConfigured ?? 'AI is not configured on this deployment', {
      ai: 'not_configured',
      feature,
    });
  }
  const message =
    state === 'off_platform'
      ? 'This AI feature is turned off on this server.'
      : state === 'region_unavailable'
        ? 'AI is unavailable: the region your company chose for AI is not offered on this server.'
        : 'AI is turned off for your company.';
  return new ApiError(HttpStatus.FORBIDDEN, ERROR_CODES.AI_DISABLED, message, { feature, reason: state });
}
