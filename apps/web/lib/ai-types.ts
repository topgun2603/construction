import type { AiFeature, AiFeatureStates, AiRegion } from '@sitebook/shared';

/** `GET /ai/settings` — Settings → Security → AI and data. */
export interface AiSettingsView {
  deployment: {
    /** False when this server has no model key: nothing the company sets will make AI work. */
    configured: boolean;
    provider: string;
    /** Which model each feature uses, from the server's configuration. */
    models: Record<AiFeature, string[]>;
    /** Features the operator has switched off for every company (`all` for everything). */
    platform_disabled: string[];
    /** Which regions this server has an endpoint for. `default` is always true. */
    regions: Record<AiRegion, boolean>;
  };
  settings: {
    enabled: boolean;
    features: Record<AiFeature, boolean>;
    region: AiRegion;
  };
  states: AiFeatureStates;
  usage: {
    days: number;
    totals: Record<AiFeature, number>;
    rows: { day: string; feature: string; calls: number }[];
  };
  documents: { chunks: number; indexed_documents: number; unindexed_documents: number };
  updated_at: string | null;
}
