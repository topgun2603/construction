/**
 * Cost codes and budgets (roadmap Phase 2, module 1) — the API's shapes.
 *
 * Kept beside `api-types.ts` rather than inside it: procurement and subcontracts will grow their
 * own types against these, and one file per module keeps those changes from colliding.
 * Money is minor units as a string, like everywhere else.
 */

/** `GET /projects/:id/cost-codes`. `budget` is null without `cost_codes.view`. */
export interface CostCode {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  unit: string | null;
  budget: string | null;
  labour_default: boolean;
  depth: number;
}

/** `variance` is budget − forecast: negative is over budget. */
export interface CostFigures {
  budget: string;
  committed: string;
  actual: string;
  forecast: string;
  variance: string;
}

export interface CostReportLine {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  unit: string | null;
  depth: number;
  labour_default: boolean;
  has_children: boolean;
  own: CostFigures;
  total: CostFigures;
  /** Budget added by approved change orders, already inside `budget`. Original = budget − this. */
  approved_changes?: { own: string; total: string };
}

/** `GET /projects/:id/cost-report`. */
export interface CostReport {
  project_id: string;
  project_name: string;
  as_of: string;
  project_budget: string | null;
  method: 'progress' | 'burn_rate' | 'spend_only';
  site_forecast: string | null;
  committed_sources: string[];
  lines: CostReportLine[];
  unallocated: CostFigures;
  totals: CostFigures;
  /** Budget added (or credited) by approved change orders across the site. */
  approved_changes?: string;
}

/** `GET /cost-code-templates`. The built-in one has id `standard`. */
export interface CostCodeTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  builtin: boolean;
  items: number;
}

export interface CostCodeTemplateLine {
  code: string;
  name: string;
  parent_code: string | null;
  unit: string | null;
}

/** `GET /cost-code-templates/:id`. */
export interface CostCodeTemplate extends CostCodeTemplateSummary {
  lines: CostCodeTemplateLine[];
}

/** What an import or a template application did. */
export interface CostCodeMergeResult {
  created: number;
  updated: number;
  skipped: number;
}
