import type {
  DocumentCitation,
  RfiAiDraft,
  RfiDiscipline,
  RfiPriority,
  RfiStatus,
  SubmittalReviewerKind,
  SubmittalStatus,
  SubmittalType,
} from '@sitebook/shared';

/** RFIs and submittals (roadmap Phase 2, module 9): what the API returns. */

export interface Person {
  id: string;
  name: string;
}

export interface RfiFile {
  id: string;
  document: { id: string; title: string; version: number } | null;
  filename: string;
  content_type: string | null;
  url: string | null;
  created_at: string;
}

export interface RfiSummary {
  id: string;
  number: number;
  label: string;
  project: { id: string; name: string };
  subject: string;
  discipline: RfiDiscipline;
  priority: RfiPriority;
  status: RfiStatus;
  overdue: boolean;
  due_on: string | null;
  raised_on: string;
  sent_at: string | null;
  answered_at: string | null;
  closed_at: string | null;
  response_days: number | null;
  addressed_to: { name: string | null; email: string | null; company: string | null; phone: string | null };
  assignee: Person | null;
  raised_by: Person | null;
  cost_impact: boolean;
  schedule_impact: boolean;
  change_order: { id: string; label: string; status: string } | null;
  response_count: number;
  link_sent_at: string | null;
}

export interface RfiResponse {
  id: string;
  body: string;
  author: { name: string; email: string | null; user: Person | null };
  external: boolean;
  is_official: boolean;
  created_at: string;
  attachments: RfiFile[];
}

export interface RfiDetail extends RfiSummary {
  question: string;
  location: string | null;
  schedule_task: { id: string; name: string } | null;
  close_note: string | null;
  void_reason: string | null;
  closed_by: Person | null;
  link_version: number;
  documents: Array<{ id: string; title: string; version: number; category: string; url: string | null }>;
  attachments: RfiFile[];
  responses: RfiResponse[];
}

export interface RfiStats {
  total: number;
  draft: number;
  open: number;
  overdue: number;
  answered: number;
  closed: number;
  avg_response_days: number | null;
}

export interface RfiSettings {
  rfi_due_days: number;
  submittal_review_days: number;
  reminder_days_before: number;
  ai_enabled: boolean;
}

/** A responder link and the message to send it with; `{url}` marks where the link goes. */
export interface RfiLink {
  url: string;
  path: string;
  expires_at: string;
  message: string;
  phone: string | null;
  email: string | null;
  subject: string;
}

export interface RfiAiResult {
  check: { answer: string; answered: boolean; sources: DocumentCitation[]; caveat: string | null } | null;
  draft: RfiAiDraft;
}

export interface SubmittalSummary {
  id: string;
  number: number;
  label: string;
  project: { id: string; name: string };
  title: string;
  type: SubmittalType;
  spec_section: string | null;
  cost_code: { id: string; code: string; name: string } | null;
  status: SubmittalStatus;
  overdue: boolean;
  due_on: string | null;
  current_revision: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  submitted_by: string | null;
  submitted_by_party: {
    user: Person | null;
    contractor: { id: string; name: string } | null;
    vendor: { id: string; name: string } | null;
  };
  reviewer: {
    kind: SubmittalReviewerKind;
    name: string | null;
    email: string | null;
    company: string | null;
    phone: string | null;
  };
  created_by: Person | null;
  created_at: string;
}

export interface SubmittalRevision {
  id: string;
  revision: number;
  label: string;
  status: SubmittalStatus;
  overdue: boolean;
  note: string | null;
  submitted_at: string | null;
  submitted_by: Person | null;
  due_on: string | null;
  review_started_at: string | null;
  reviewed_at: string | null;
  reviewed_by: Person | null;
  reviewer_name: string | null;
  reviewer_email: string | null;
  review_comments: string | null;
  approval: { id: string; status: string; decided_at: string | null } | null;
  link_sent_at: string | null;
  files: RfiFile[];
  markups: RfiFile[];
}

export interface SubmittalDetail extends SubmittalSummary {
  description: string | null;
  revisions: SubmittalRevision[];
}

export interface SubmittalStats {
  total: number;
  in_review: number;
  overdue: number;
  approved: number;
  returned: number;
  avg_review_days: number | null;
}

/** What the responder's page reads: one RFI or one submittal revision, nothing else. */
export interface ResponderCompany {
  name: string;
  logo_url: string | null;
  currency?: string;
  locale?: string;
  timezone?: string;
}

export interface ResponderFile {
  id: string;
  filename: string;
  url: string | null;
}

export type ResponderView =
  | {
      kind: 'rfi';
      company: ResponderCompany;
      site: { name: string };
      can_respond: boolean;
      rfi: {
        label: string;
        subject: string;
        question: string;
        discipline: RfiDiscipline;
        priority: RfiPriority;
        location: string | null;
        status: RfiStatus;
        overdue: boolean;
        due_on: string | null;
        sent_at: string | null;
        addressed_to_name: string | null;
        documents: Array<{ title: string; version: number; url: string | null }>;
        attachments: ResponderFile[];
        responses: Array<{
          id: string;
          author_name: string;
          external: boolean;
          is_official: boolean;
          body: string;
          created_at: string;
          attachments: ResponderFile[];
        }>;
      };
    }
  | {
      kind: 'submittal';
      company: ResponderCompany;
      site: { name: string };
      can_respond: boolean;
      submittal: {
        label: string;
        title: string;
        type: SubmittalType;
        spec_section: string | null;
        description: string | null;
        submitted_by: string | null;
        reviewer_name: string | null;
        revision: number;
        status: SubmittalStatus;
        overdue: boolean;
        due_on: string | null;
        submitted_at: string | null;
        note: string | null;
        reviewed_at: string | null;
        reviewer: string | null;
        review_comments: string | null;
        files: ResponderFile[];
        markups: ResponderFile[];
      };
    };
