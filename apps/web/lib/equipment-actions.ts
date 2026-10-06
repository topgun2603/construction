'use server';

import { revalidatePath } from 'next/cache';
import type {
  AllocateEquipmentInput,
  CreateEquipmentDocumentInput,
  CreateEquipmentServicePlanInput,
  ReleaseEquipmentInput,
  UpdateEquipmentDocumentInput,
} from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type {
  EquipmentDocument,
  EquipmentFuelBillScan,
  EquipmentHireStatement,
  EquipmentLog,
  EquipmentMaintenanceRecord,
  EquipmentMeterScan,
  EquipmentServicePlan,
  EquipmentSummary,
} from './equipment-types';

/**
 * Equipment and plant (roadmap Phase 2, module 10). In a file of its own, like safety and
 * subcontracts, so the module's writes read together and do not collide with `actions.ts`.
 *
 * Money crosses as minor-unit strings — the forms convert what a person typed with
 * `amountToMinorString` before calling these.
 */

function refresh(id?: string, projectId?: string | null) {
  revalidatePath('/equipment');
  if (id) revalidatePath(`/equipment/${id}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

/** The register's fields as the form sends them. */
export interface EquipmentFormInput {
  code?: string;
  name: string;
  category: string;
  make?: string | null;
  model?: string | null;
  registration_no?: string | null;
  serial_no?: string | null;
  year?: number | null;
  quantity?: number;
  ownership: 'owned' | 'hired';
  vendor_id?: string | null;
  hire_basis?: 'hour' | 'day' | 'month' | null;
  hire_rate?: string;
  min_hours?: string | null;
  operator_included?: boolean;
  operator_rate?: string;
  fuel_included?: boolean;
  mobilisation_charge?: string;
  charge_out_basis?: 'hour' | 'day' | null;
  charge_out_rate?: string;
  meter_type?: 'hours' | 'km' | 'none';
  meter_reading?: string | null;
  notes?: string | null;
  status?: string;
}

export async function createEquipment(input: EquipmentFormInput): Promise<ActionResult<EquipmentSummary>> {
  const result = await runAction(() => serverFetch<EquipmentSummary>('/equipment', { method: 'POST', body: input }));
  if (result.ok) refresh();
  return result;
}

export async function updateEquipment(
  id: string,
  input: Partial<EquipmentFormInput>,
): Promise<ActionResult<EquipmentSummary>> {
  const result = await runAction(() =>
    serverFetch<EquipmentSummary>(`/equipment/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(id, result.data?.current_site?.project.id);
  return result;
}

export async function archiveEquipment(id: string): Promise<ActionResult<null>> {
  const result = await runAction(() => serverFetch<null>(`/equipment/${id}`, { method: 'DELETE' }));
  if (result.ok) refresh(id);
  return result;
}

export async function allocateEquipment(id: string, input: AllocateEquipmentInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(() =>
    serverFetch<{ id: string }>(`/equipment/${id}/allocations`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(id, input.project_id);
  return result;
}

export async function releaseEquipment(
  id: string,
  input: ReleaseEquipmentInput,
  projectId?: string,
): Promise<ActionResult<{ id: string; status: string }>> {
  const result = await runAction(() =>
    serverFetch<{ id: string; status: string }>(`/equipment/${id}/release`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(id, projectId);
  return result;
}

/** A day's log as the form sends it, with any fuel issued the same day. */
export interface EquipmentLogFormInput {
  equipment_id: string;
  log_date: string;
  opening_meter?: string | null;
  closing_meter?: string | null;
  hours_worked?: string | null;
  idle_hours?: string;
  breakdown_hours?: string;
  operator_worker_id?: string | null;
  operator_name?: string | null;
  work_done?: string | null;
  meter_photo_key?: string | null;
  fuel?: {
    litres: string;
    amount?: string;
    source: 'direct' | 'expense' | 'stock' | 'vendor';
    material_id?: string | null;
    create_expense?: boolean;
    bill_s3_key?: string | null;
  };
  client_id?: string;
}

export async function logEquipmentDay(input: EquipmentLogFormInput): Promise<ActionResult<EquipmentLog>> {
  const result = await runAction(() => serverFetch<EquipmentLog>('/equipment/logs', { method: 'POST', body: input }));
  if (result.ok) refresh(input.equipment_id, result.data?.project.id);
  return result;
}

export async function deleteEquipmentLog(id: string, equipmentId: string): Promise<ActionResult<null>> {
  const result = await runAction(() => serverFetch<null>(`/equipment/logs/${id}`, { method: 'DELETE' }));
  if (result.ok) refresh(equipmentId);
  return result;
}

/** Read a meter photo. Nothing is saved: the reading fills the form and the person confirms it. */
export async function scanEquipmentMeter(s3Key: string): Promise<ActionResult<EquipmentMeterScan>> {
  return runAction(() =>
    serverFetch<EquipmentMeterScan>('/equipment/scan/meter', { method: 'POST', body: { s3_key: s3Key } }),
  );
}

export async function scanEquipmentFuelBill(s3Key: string): Promise<ActionResult<EquipmentFuelBillScan>> {
  return runAction(() =>
    serverFetch<EquipmentFuelBillScan>('/equipment/scan/fuel-bill', { method: 'POST', body: { s3_key: s3Key } }),
  );
}

export interface EquipmentMaintenanceFormInput {
  done_on: string;
  kind: 'preventive' | 'breakdown';
  description: string;
  parts?: string | null;
  cost?: string;
  meter_reading?: string | null;
  downtime_hours?: string | null;
  plan_id?: string | null;
  project_id?: string | null;
  vendor_name?: string | null;
  create_expense?: boolean;
}

export async function recordEquipmentMaintenance(
  equipmentId: string,
  input: EquipmentMaintenanceFormInput,
): Promise<ActionResult<EquipmentMaintenanceRecord>> {
  const result = await runAction(() =>
    serverFetch<EquipmentMaintenanceRecord>(`/equipment/${equipmentId}/maintenance`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(equipmentId, result.data?.project?.id);
  return result;
}

export async function addEquipmentServicePlan(
  equipmentId: string,
  input: CreateEquipmentServicePlanInput,
): Promise<ActionResult<EquipmentServicePlan>> {
  const result = await runAction(() =>
    serverFetch<EquipmentServicePlan>(`/equipment/${equipmentId}/service-plans`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(equipmentId);
  return result;
}

export async function setEquipmentServicePlanActive(
  equipmentId: string,
  planId: string,
  active: boolean,
): Promise<ActionResult<EquipmentServicePlan>> {
  const result = await runAction(() =>
    serverFetch<EquipmentServicePlan>(`/equipment/service-plans/${planId}`, { method: 'PATCH', body: { active } }),
  );
  if (result.ok) refresh(equipmentId);
  return result;
}

export async function addEquipmentDocument(
  equipmentId: string,
  input: CreateEquipmentDocumentInput,
): Promise<ActionResult<EquipmentDocument>> {
  const result = await runAction(() =>
    serverFetch<EquipmentDocument>(`/equipment/${equipmentId}/documents`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(equipmentId);
  return result;
}

export async function updateEquipmentDocument(
  equipmentId: string,
  documentId: string,
  input: UpdateEquipmentDocumentInput,
): Promise<ActionResult<EquipmentDocument>> {
  const result = await runAction(() =>
    serverFetch<EquipmentDocument>(`/equipment/documents/${documentId}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(equipmentId);
  return result;
}

export async function removeEquipmentDocument(equipmentId: string, documentId: string): Promise<ActionResult<null>> {
  const result = await runAction(() => serverFetch<null>(`/equipment/documents/${documentId}`, { method: 'DELETE' }));
  if (result.ok) refresh(equipmentId);
  return result;
}

export async function bookEquipmentHire(input: {
  vendor_id: string;
  month: string;
  invoice_ref?: string;
}): Promise<ActionResult<EquipmentHireStatement>> {
  const result = await runAction(() =>
    serverFetch<EquipmentHireStatement>('/equipment/hire-statement/book', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/equipment/hire-statement');
    revalidatePath('/equipment');
  }
  return result;
}
