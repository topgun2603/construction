'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { runAction, serverFetch, type ActionResult } from './server-api';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './session';
import type {
  Approval,
  AttendanceDay,
  Billing,
  ClientPayment,
  DailyReport,
  PaymentStage,
  SiteDocument,
  SiteMessage,
  Indent,
  MaterialEstimate,
  Milestone,
  ProjectMedia,
  Role,
  StartedSubscription,
  StockMovement,
  WagePeriodDetail,
  Worker,
} from './api-types';

/**
 * Sign out. Revokes every session server-side *and* clears the cookies â€” dropping
 * only the cookies would leave a stolen refresh token usable for 30 days.
 */
export async function signOut(): Promise<never> {
  await runAction(() => serverFetch('/auth/logout', { method: 'POST' }));

  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);

  redirect('/login');
}

/*
 * Server actions for every mutation the dashboard performs.
 *
 * They run on the server with the session cookie, so no API token is ever shipped
 * to the browser, and each one revalidates the paths whose data it changed rather
 * than the whole app â€” a roll call save should not re-fetch the settings page.
 */

// --- labour ---------------------------------------------------------------

export async function saveAttendance(input: {
  projectId: string;
  date: string;
  rows: Array<{ worker_id: string; status: string; overtime_hours: string }>;
}): Promise<ActionResult<AttendanceDay>> {
  const result = await runAction(() =>
    serverFetch<AttendanceDay>('/attendance', {
      method: 'POST',
      body: {
        project_id: input.projectId,
        attendance_date: input.date,
        rows: input.rows,
      },
    }),
  );
  if (result.ok) {
    revalidatePath('/labour/attendance');
    revalidatePath('/overview');
  }
  return result;
}

export async function createWorker(input: {
  name: string;
  trade?: string;
  phone?: string;
  contractor_id?: string | null;
  skill_level: string;
  daily_wage: string;
  overtime_rate_per_hour: string;
  project_id?: string;
  from_date?: string;
}): Promise<ActionResult<Worker>> {
  const result = await runAction(() =>
    serverFetch<Worker>('/workers', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/labour/workers');
    revalidatePath('/labour/attendance');
  }
  return result;
}

export async function recordPayment(input: {
  type: 'advance' | 'bonus' | 'deduction';
  amount: string;
  paid_on: string;
  mode: string;
  worker_id?: string;
  contractor_id?: string;
  note?: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch('/labour-payments', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/labour/payments');
    revalidatePath('/labour/wage-periods');
  }
  return result;
}

export async function generateWagePeriod(input: {
  contractor_id: string | null;
  period_start: string;
  period_end: string;
}): Promise<ActionResult<WagePeriodDetail>> {
  const result = await runAction(() =>
    serverFetch<WagePeriodDetail>('/wage-periods/generate', { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath('/labour/wage-periods');
  return result;
}

export async function finaliseWagePeriod(id: string): Promise<ActionResult<WagePeriodDetail>> {
  const result = await runAction(() =>
    serverFetch<WagePeriodDetail>(`/wage-periods/${id}/finalise`, { method: 'POST' }),
  );
  if (result.ok) {
    revalidatePath('/labour/wage-periods');
    revalidatePath(`/labour/wage-periods/${id}`);
  }
  return result;
}

export async function payWagePeriod(
  id: string,
  input: { paid_on: string; mode: string; reference?: string },
): Promise<ActionResult<WagePeriodDetail>> {
  const result = await runAction(() =>
    serverFetch<WagePeriodDetail>(`/wage-periods/${id}/pay`, { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/labour/wage-periods');
    revalidatePath(`/labour/wage-periods/${id}`);
    revalidatePath('/labour/payments');
  }
  return result;
}

// --- stock ----------------------------------------------------------------

/*
 * Materials stock. Every one of these revalidates the overrun report as well as the ledger:
 * stock and "are we over" are two views of the same rows, and showing one updated while the
 * other is stale is how people stop trusting the numbers.
 */

export async function recordStockMovement(input: {
  project_id: string;
  material_id: string;
  type: 'in' | 'out';
  quantity: string;
  moved_on: string;
  ref?: string;
  note?: string;
}): Promise<ActionResult<StockMovement>> {
  const result = await runAction(() =>
    serverFetch<StockMovement>('/stock/movements', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/stock');
    revalidatePath('/stock/movements');
    revalidatePath('/reports/overrun');
  }
  return result;
}

export async function setMaterialEstimates(input: {
  projectId: string;
  items: Array<{ material_id: string; estimated_quantity: string; note?: string }>;
}): Promise<ActionResult<MaterialEstimate[]>> {
  const result = await runAction(() =>
    serverFetch<MaterialEstimate[]>(`/stock/estimates/${input.projectId}`, {
      method: 'PUT',
      body: { items: input.items },
    }),
  );
  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}`);
    revalidatePath('/reports/overrun');
  }
  return result;
}

export async function removeMaterialEstimate(input: {
  projectId: string;
  materialId: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/stock/estimates/${input.projectId}/${input.materialId}`, { method: 'DELETE' }),
  );
  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}`);
    revalidatePath('/reports/overrun');
  }
  return result;
}

/**
 * Receive an indent with a count per line.
 *
 * Quantities are explicit rather than "mark it all received": the gap between ordered and
 * delivered is the thing worth catching, and one button would assume it away.
 */
export async function receiveIndent(input: {
  id: string;
  items: Array<{ material_id: string; received_quantity: string }>;
  note?: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/indents/${input.id}/status`, {
      method: 'PATCH',
      body: {
        status: 'received',
        received: input.items,
        ...(input.note ? { note: input.note } : {}),
      },
    }),
  );
  if (result.ok) {
    revalidatePath('/indents');
    revalidatePath('/stock');
    revalidatePath('/reports/overrun');
  }
  return result;
}

/** Correct the counts on a delivery already received. Not a status change. */
export async function amendIndentReceipt(input: {
  id: string;
  items: Array<{ material_id: string; received_quantity: string }>;
  ref?: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/indents/${input.id}/receipt`, {
      method: 'PATCH',
      body: { items: input.items, ...(input.ref ? { ref: input.ref } : {}) },
    }),
  );
  if (result.ok) {
    revalidatePath('/indents');
    revalidatePath('/stock');
    revalidatePath('/reports/overrun');
  }
  return result;
}

// --- wage period lifecycle ------------------------------------------------

/**
 * Discard an open period, or reopen a finalised one that has not been paid.
 *
 * Both revalidate the list as well as the period: discarding removes a row from it, and
 * reopening changes the status badge the list shows.
 */
export async function discardWagePeriod(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/wage-periods/${id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath('/labour/wage-periods');
  return result;
}

export async function reopenWagePeriod(id: string): Promise<ActionResult<WagePeriodDetail>> {
  const result = await runAction(() =>
    serverFetch<WagePeriodDetail>(`/wage-periods/${id}/reopen`, { method: 'POST' }),
  );
  if (result.ok) {
    revalidatePath('/labour/wage-periods');
    revalidatePath(`/labour/wage-periods/${id}`);
    // Attendance is unlocked again, so the roll call screen must stop saying otherwise.
    revalidatePath('/labour/attendance');
  }
  return result;
}

// --- indents --------------------------------------------------------------

export async function setIndentStatus(
  id: string,
  status: 'approved' | 'rejected' | 'ordered' | 'received',
  note?: string,
): Promise<ActionResult<Indent>> {
  const result = await runAction(() =>
    serverFetch<Indent>(`/indents/${id}/status`, {
      method: 'PATCH',
      body: { status, ...(note ? { note } : {}) },
    }),
  );
  if (result.ok) {
    revalidatePath('/indents');
    revalidatePath('/overview');
  }
  return result;
}

// --- expenses -------------------------------------------------------------

export async function recordExpense(input: {
  project_id: string;
  amount: string;
  category: string;
  spent_on: string;
  note?: string;
  bill_s3_key?: string;
}): Promise<ActionResult> {
  const result = await runAction(() => serverFetch('/expenses', { method: 'POST', body: input }));
  if (result.ok) {
    revalidatePath('/expenses');
    // Spend feeds the overview tiles and every site card.
    revalidatePath('/overview');
  }
  return result;
}

export async function decideExpense(
  id: string,
  status: 'approved' | 'rejected',
  note?: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/expenses/${id}/decision`, {
      method: 'PATCH',
      body: { status, ...(note ? { note } : {}) },
    }),
  );
  if (result.ok) {
    revalidatePath('/expenses');
    revalidatePath('/overview');
  }
  return result;
}

export async function discardExpense(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/expenses/${id}`, { method: 'DELETE' }));
  if (result.ok) {
    revalidatePath('/expenses');
    revalidatePath('/overview');
  }
  return result;
}

// --- roles ----------------------------------------------------------------

/*
 * Owner-defined roles. Every one of these revalidates the team page as well as the roles
 * page: changing what a role may do changes what the team list should be showing about the
 * people on it.
 */

export async function createRole(input: {
  name: string;
  base_role: string;
  permissions: string[];
  sees_all_projects: boolean;
}): Promise<ActionResult<Role>> {
  const result = await runAction(() =>
    serverFetch<Role>('/roles', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/settings/roles');
    revalidatePath('/settings/team');
  }
  return result;
}

export async function updateRole(input: {
  id: string;
  name?: string;
  permissions?: string[];
  sees_all_projects?: boolean;
}): Promise<ActionResult<Role>> {
  const { id, ...patch } = input;
  const result = await runAction(() =>
    serverFetch<Role>(`/roles/${id}`, { method: 'PATCH', body: patch }),
  );
  if (result.ok) {
    revalidatePath('/settings/roles');
    revalidatePath('/settings/team');
  }
  return result;
}

export async function deleteRole(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/roles/${id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath('/settings/roles');
  return result;
}

export async function assignRole(input: {
  userId: string;
  roleId: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/roles/members/${input.userId}`, {
      method: 'PATCH',
      body: { role_id: input.roleId },
    }),
  );
  if (result.ok) {
    revalidatePath('/settings/team');
    revalidatePath('/settings/roles');
  }
  return result;
}

// --- deletes --------------------------------------------------------------

/*
 * One action per deletable record. They are grouped here rather than scattered
 * through the module sections above because they share a contract: the API decides
 * whether the delete is allowed, and the message it returns is the one the user reads.
 * None of them pre-check the rule client-side â€” the server is the only place that can
 * know whether a worker is on an unpaid sheet.
 */

export async function deleteWorker(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/workers/${id}`, { method: 'DELETE' }));
  if (result.ok) {
    revalidatePath('/labour/workers');
    revalidatePath('/labour/attendance');
  }
  return result;
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/projects/${id}`, { method: 'DELETE' }));
  if (result.ok) {
    revalidatePath('/projects');
    revalidatePath('/overview');
  }
  return result;
}

export async function deleteContractor(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/contractors/${id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath('/settings/contractors');
  return result;
}

export async function deleteMaterial(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/materials/${id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath('/settings/materials');
  return result;
}

export async function deleteIndent(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/indents/${id}`, { method: 'DELETE' }));
  if (result.ok) {
    revalidatePath('/indents');
    revalidatePath('/overview');
  }
  return result;
}

export async function deletePayment(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/labour-payments/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath('/labour/payments');
  return result;
}

export async function removeTeamMember(userId: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/tenants/current/team/${userId}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath('/settings/team');
  return result;
}

export async function deleteDailyReport(input: {
  id: string;
  projectId: string;
}): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/dpr/${input.id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

/**
 * Edit a site.
 *
 * Takes the already-computed patch rather than a full object, so the caller can send only what
 * changed. A PATCH carrying every field would overwrite whatever a colleague edited while the dialog
 * sat open â€” on a site several people manage, that is a real loss rather than a theoretical one.
 */
export async function updateProject(input: {
  projectId: string;
  patch: Record<string, unknown>;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${input.projectId}`, { method: 'PATCH', body: input.patch }),
  );
  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}`);
    revalidatePath('/projects');
    // The name, status and budget all show on the overview cards.
    revalidatePath('/overview');
  }
  return result;
}

// --- site media -----------------------------------------------------------

/**
 * Uploading is two steps: ask for a presigned URL, PUT the bytes straight to storage, then record
 * that the file exists. The bytes never pass through this server, which is what keeps a 200 MB video
 * from occupying a request thread.
 */
/**
 * File a daily progress report.
 *
 * Created as a draft and then submitted, two calls on purpose: the draft exists even if the second
 * one never lands, so a browser that closed mid-send has not lost the day's report.
 */
export async function fileDailyReport(input: {
  project_id: string;
  report_date: string;
  work_done?: string;
  issues?: string;
  weather?: string;
  manpower?: Array<{ trade: string; count: number }>;
  photos?: Array<{ s3_key: string; caption?: string }>;
}): Promise<ActionResult<DailyReport>> {
  const created = await runAction(() =>
    serverFetch<DailyReport>('/dpr', { method: 'POST', body: { ...input, status: 'draft' } }),
  );
  if (!created.ok || !created.data) return created;

  const submitted = await runAction(() =>
    serverFetch<DailyReport>(`/dpr/${created.data!.id}/submit`, { method: 'POST' }),
  );
  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath('/overview');
  return submitted.ok ? submitted : created;
}

/**
 * Say something on a site.
 *
 * `audience: 'team'` is refused by the API for anybody without `messages.internal` rather than
 * quietly downgraded â€” so the UI only offers the choice to people who have it, and a mismatch
 * surfaces as an error instead of publishing something written in confidence.
 */
export async function postSiteMessage(input: {
  projectId: string;
  body: string;
  audience: 'everyone' | 'team' | 'direct';
  /** Required for `direct`, refused otherwise â€” the API enforces both halves. */
  recipientId?: string;
  attachments?: Array<{
    s3_key: string;
    content_type: string;
    size_bytes: number;
    filename?: string;
  }>;
}): Promise<ActionResult<SiteMessage>> {
  const result = await runAction(() =>
    serverFetch<SiteMessage>(`/projects/${input.projectId}/messages`, {
      method: 'POST',
      body: {
        body: input.body,
        audience: input.audience,
        ...(input.recipientId ? { recipient_id: input.recipientId } : {}),
        attachments: input.attachments ?? [],
      },
    }),
  );
  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

/**
 * The client's payment schedule.
 *
 * Amounts cross the wire as decimal strings of paise, the same as every other money field â€” a JSON
 * number is a double in the browser and loses paise above 2^53.
 */
export async function createPaymentStage(input: {
  projectId: string;
  label: string;
  amount: string;
  milestone_id?: string | null;
  due_date?: string | null;
}): Promise<ActionResult<PaymentStage>> {
  const { projectId, ...body } = input;
  const result = await runAction(() =>
    serverFetch<PaymentStage>(`/projects/${projectId}/payment-schedule`, {
      method: 'POST',
      body,
    }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function updatePaymentStage(input: {
  id: string;
  projectId: string;
  label?: string;
  amount?: string;
  milestone_id?: string | null;
  due_date?: string | null;
  /** Marks it asked-for; the server stamps when, and re-raising does not move that. */
  raised?: boolean;
}): Promise<ActionResult<PaymentStage>> {
  const { id, projectId, ...body } = input;
  const result = await runAction(() =>
    serverFetch<PaymentStage>(`/payment-stages/${id}`, { method: 'PATCH', body }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function deletePaymentStage(
  id: string,
  projectId: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/payment-stages/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function recordClientPayment(input: {
  projectId: string;
  amount: string;
  received_on: string;
  mode: 'cash' | 'upi' | 'bank';
  stage_id?: string | null;
  reference?: string;
  note?: string;
}): Promise<ActionResult<ClientPayment>> {
  const { projectId, ...body } = input;
  const result = await runAction(() =>
    serverFetch<ClientPayment>(`/projects/${projectId}/payment-schedule/receipts`, {
      method: 'POST',
      body,
    }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function deleteClientPayment(
  id: string,
  projectId: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/client-payments/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

/** Ask the client to sign something off. */
export async function createApproval(input: {
  projectId: string;
  title: string;
  body?: string;
  document_id?: string | null;
}): Promise<ActionResult<Approval>> {
  const { projectId, ...body } = input;
  const result = await runAction(() =>
    serverFetch<Approval>(`/projects/${projectId}/approvals`, { method: 'POST', body }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Answer one, on the record.
 *
 * There is no way back to pending and no editing the note afterwards â€” the API refuses both. An
 * approval somebody can quietly revise is evidence of nothing.
 */
export async function decideApproval(input: {
  id: string;
  projectId: string;
  status: 'approved' | 'rejected';
  note?: string;
}): Promise<ActionResult<Approval>> {
  const { id, projectId, ...body } = input;
  const result = await runAction(() =>
    serverFetch<Approval>(`/approvals/${id}`, { method: 'PATCH', body }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function deleteApproval(id: string, projectId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/approvals/${id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Marks the conversation read up to now.
 *
 * Deliberately does not revalidate the page. This fires when somebody opens the thread, and
 * re-rendering the server component underneath them would replace the messages they are reading
 * with an identical set â€” a visible flicker, to record something they cannot see anyway.
 */
export async function markMessagesRead(projectId: string): Promise<ActionResult> {
  return runAction(() =>
    serverFetch(`/projects/${projectId}/messages/read`, { method: 'POST', body: {} }),
  );
}

export async function deleteSiteMessage(
  projectId: string,
  messageId: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/messages/${messageId}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Record an uploaded document.
 *
 * `supersedes_id` files it as the next revision of an existing document, taking that document's
 * title, category and visibility with it â€” a revision must not be able to rename a drawing into a
 * contract, or quietly stop being shared with the client who is building to it.
 */
export async function createDocument(input: {
  project_id: string | null;
  title: string;
  category: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  visible_to_client?: boolean;
  supersedes_id?: string;
}): Promise<ActionResult<SiteDocument>> {
  const result = await runAction(() =>
    serverFetch<SiteDocument>('/documents', { method: 'POST', body: input }),
  );
  if (result.ok && input.project_id) revalidatePath(`/projects/${input.project_id}`);
  return result;
}

export async function updateDocument(input: {
  id: string;
  projectId: string | null;
  title?: string;
  category?: string;
  visible_to_client?: boolean;
}): Promise<ActionResult<SiteDocument>> {
  const { id, projectId, ...patch } = input;
  const result = await runAction(() =>
    serverFetch<SiteDocument>(`/documents/${id}`, { method: 'PATCH', body: patch }),
  );
  if (result.ok && projectId) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function deleteDocument(
  id: string,
  projectId: string | null,
): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/documents/${id}`, { method: 'DELETE' }));
  if (result.ok && projectId) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function presignUpload(input: {
  kind: string;
  content_type: string;
  content_length: number;
  project_id?: string;
}): Promise<ActionResult<{ url: string; s3_key: string; headers: Record<string, string> }>> {
  return runAction(() =>
    serverFetch<{ url: string; s3_key: string; headers: Record<string, string> }>(
      '/uploads/presign',
      { method: 'POST', body: input },
    ),
  );
}

/** A short-lived URL to display one object. Signed per render; the object itself stays private. */
export async function viewUrl(s3Key: string): Promise<ActionResult<{ url: string }>> {
  return runAction(() =>
    serverFetch<{ url: string }>('/uploads/view', { method: 'POST', body: { s3_key: s3Key } }),
  );
}

export async function addProjectMedia(input: {
  projectId: string;
  kind: 'photo' | 'video';
  s3_key: string;
  content_type: string;
  size_bytes: number;
  caption?: string;
}): Promise<ActionResult<ProjectMedia>> {
  const { projectId, ...body } = input;
  const result = await runAction(() =>
    serverFetch<ProjectMedia>(`/projects/${projectId}/media`, { method: 'POST', body }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function updateProjectMedia(input: {
  projectId: string;
  mediaId: string;
  caption?: string | null;
}): Promise<ActionResult<ProjectMedia>> {
  const { projectId, mediaId, ...patch } = input;
  const result = await runAction(() =>
    serverFetch<ProjectMedia>(`/projects/${projectId}/media/${mediaId}`, {
      method: 'PATCH',
      body: patch,
    }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Rearrange a site's photos and videos.
 *
 * The ids sent take the front in the order given, so moving one photo to the main slot is a
 * one-element request. The sites list is revalidated too: the first photo is what its cards lead with.
 */
export async function reorderProjectMedia(input: {
  projectId: string;
  mediaIds: string[];
}): Promise<ActionResult<ProjectMedia[]>> {
  const result = await runAction(() =>
    serverFetch<ProjectMedia[]>(`/projects/${input.projectId}/media/order`, {
      method: 'PUT',
      body: { media_ids: input.mediaIds },
    }),
  );
  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}`);
    revalidatePath('/projects');
  }
  return result;
}

export async function removeProjectMedia(input: {
  projectId: string;
  mediaId: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${input.projectId}/media/${input.mediaId}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

// --- milestones -----------------------------------------------------------

/*
 * The timeline for one site. Every action revalidates that project's page only: a
 * milestone is the one thing on the screen that changed, and the sites list does not
 * show them.
 */

export async function addMilestone(input: {
  projectId: string;
  name: string;
  planned_date?: string;
}): Promise<ActionResult<Milestone>> {
  const result = await runAction(() =>
    serverFetch<Milestone>(`/projects/${input.projectId}/milestones`, {
      method: 'POST',
      body: {
        name: input.name,
        ...(input.planned_date ? { planned_date: input.planned_date } : {}),
      },
    }),
  );
  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function updateMilestone(input: {
  projectId: string;
  milestoneId: string;
  name?: string;
  /** null clears the date; undefined leaves it alone. */
  planned_date?: string | null;
  actual_date?: string | null;
}): Promise<ActionResult<Milestone>> {
  const { projectId, milestoneId, ...patch } = input;
  const result = await runAction(() =>
    serverFetch<Milestone>(`/projects/${projectId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      body: patch,
    }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function deleteMilestone(input: {
  projectId: string;
  milestoneId: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${input.projectId}/milestones/${input.milestoneId}`, {
      method: 'DELETE',
    }),
  );
  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function reorderMilestones(input: {
  projectId: string;
  milestoneIds: string[];
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${input.projectId}/milestones/reorder`, {
      method: 'PATCH',
      body: { milestone_ids: input.milestoneIds },
    }),
  );
  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

// --- billing --------------------------------------------------------------

/**
 * Start a subscription and get Razorpay's checkout link.
 *
 * The plan is not applied here and this action cannot apply it â€” only a signature-verified webhook
 * can. Revalidating is still right: the subscription row moves to `trialing`, and the screen should
 * say so rather than look untouched after the owner clicked upgrade.
 */
export async function startSubscription(plan: string): Promise<ActionResult<StartedSubscription>> {
  const result = await runAction(() =>
    serverFetch<StartedSubscription>('/billing/subscribe', { method: 'POST', body: { plan } }),
  );
  if (result.ok) revalidatePath('/settings/plan');
  return result;
}

export async function cancelSubscription(atPeriodEnd: boolean): Promise<ActionResult<Billing>> {
  const result = await runAction(() =>
    serverFetch<Billing>('/billing/cancel', {
      method: 'POST',
      body: { at_period_end: atPeriodEnd },
    }),
  );
  if (result.ok) {
    revalidatePath('/settings/plan');
    // An immediate cancel drops the plan, which changes what the whole shell shows.
    revalidatePath('/overview');
  }
  return result;
}

// --- settings -------------------------------------------------------------

export async function inviteTeamMember(input: {
  phone: string;
  name: string;
  role: string;
  project_ids?: string[];
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch('/tenants/current/invite', { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath('/settings/team');
  return result;
}

/**
 * Put somebody on a site.
 *
 * Sending the same person twice updates what they do there rather than failing, so a mis-picked role
 * is corrected by adding them again.
 */
export async function addProjectMember(input: {
  projectId: string;
  userId: string;
  roleOnProject: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${input.projectId}/members`, {
      method: 'POST',
      body: { user_id: input.userId, role_on_project: input.roleOnProject },
    }),
  );
  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function createContractor(input: {
  name: string;
  trade?: string;
  phone?: string;
  payment_terms: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch('/contractors', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/settings/contractors');
    revalidatePath('/labour/workers');
  }
  return result;
}

export async function createMaterial(input: {
  name: string;
  unit: string;
  category?: string;
}): Promise<ActionResult> {
  const result = await runAction(() => serverFetch('/materials', { method: 'POST', body: input }));
  if (result.ok) revalidatePath('/settings/materials');
  return result;
}

export async function createProject(input: {
  name: string;
  client_name?: string;
  address?: string;
  start_date?: string;
  target_end_date?: string;
  budget_amount?: string;
  /** Sent together or not at all â€” half a coordinate is a point in the sea, not a partial answer. */
  lat?: number;
  lng?: number;
}): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(() =>
    serverFetch<{ id: string }>('/projects', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/projects');
    revalidatePath('/overview');
  }
  return result;
}

export async function updateTenant(input: {
  name?: string;
  logo_url?: string | null;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch('/tenants/current', { method: 'PATCH', body: input }),
  );
  if (result.ok) revalidatePath('/settings/plan');
  return result;
}

/**
 * Mints a worker's self-service link and returns the path to it.
 *
 * The path, not the whole URL: the API knows the token but not what address this app is being
 * served on, and the button that sends it resolves the path against the browser's own origin. One
 * fewer thing to configure, and no risk of sending somebody a link to a hostname that only
 * resolves inside the deployment.
 */
export async function workerSelfServiceLink(
  workerId: string,
): Promise<ActionResult<{ path: string }>> {
  const result = await runAction(() =>
    serverFetch<{ url: string }>(`/workers/${workerId}/self-service-link`, { method: 'POST' }),
  );
  // The failure carries no data, so nothing is being reinterpreted here — only the shape of the
  // success case differs between what the API returns and what the caller wants.
  if (!result.ok || !result.data) {
    return { ok: result.ok, ...(result.error ? { error: result.error } : {}) };
  }

  const { url } = result.data;
  const path = url.startsWith('http') ? new URL(url).pathname : url;
  return { ok: true, data: { path } };
}
