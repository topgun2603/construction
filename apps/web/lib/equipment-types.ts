/**
 * Equipment and plant (roadmap Phase 2, module 10) — the API's response shapes. Money is a
 * minor-unit string, or null for somebody without `equipment.view`; hours and readings are decimal
 * strings with at most one decimal.
 */

export type EquipmentServiceStateName = 'ok' | 'due_soon' | 'due' | 'overdue';
export type EquipmentDocumentStandingName = 'valid' | 'expiring' | 'expired' | 'no_expiry';

export interface EquipmentRef {
  id: string;
  code: string;
  name: string;
}

export interface EquipmentSummary {
  id: string;
  code: string;
  name: string;
  category: string;
  make: string | null;
  model: string | null;
  registration_no: string | null;
  serial_no: string | null;
  year: number | null;
  quantity: number;
  ownership: 'owned' | 'hired';
  vendor: { id: string; name: string } | null;
  hire_basis: 'hour' | 'day' | 'month' | null;
  hire_rate: string | null;
  min_hours: string | null;
  operator_included: boolean;
  operator_rate: string | null;
  fuel_included: boolean;
  mobilisation_charge: string | null;
  charge_out_basis: 'hour' | 'day' | null;
  charge_out_rate: string | null;
  meter_type: 'hours' | 'km' | 'none';
  meter_reading: string | null;
  status: 'available' | 'on_site' | 'under_maintenance' | 'off_hire';
  notes: string | null;
  archived: boolean;
  current_site: {
    allocation_id: string;
    project: { id: string; name: string };
    cost_code: { id: string; code: string; name: string } | null;
    since: string;
  } | null;
  service_state: EquipmentServiceStateName;
  documents_state: EquipmentDocumentStandingName;
}

export interface EquipmentLog {
  id: string;
  equipment: EquipmentRef & { meterType: string };
  project: { id: string; name: string };
  cost_code: { id: string; code: string; name: string } | null;
  log_date: string;
  opening_meter: string | null;
  closing_meter: string | null;
  hours_worked: string | null;
  idle_hours: string | null;
  breakdown_hours: string | null;
  distance: string | null;
  operator: { worker_id: string | null; name: string } | null;
  work_done: string | null;
  has_meter_photo: boolean;
  fuel_litres: string | null;
  fuel_per_hour: number | null;
  recorded_by: { id: string; name: string };
  created_at: string;
}

export interface EquipmentServicePlan {
  id: string;
  equipment_id: string;
  name: string;
  interval_meter: string | null;
  interval_days: number | null;
  last_done_meter: string | null;
  last_done_on: string | null;
  active: boolean;
  state: EquipmentServiceStateName;
  next_meter: string | null;
  remaining_meter: string | null;
  next_on: string | null;
  remaining_days: number | null;
}

export interface EquipmentMaintenanceRecord {
  id: string;
  equipment: EquipmentRef;
  project: { id: string; name: string } | null;
  plan: { id: string; name: string } | null;
  done_on: string;
  kind: 'preventive' | 'breakdown';
  description: string;
  parts: string | null;
  cost: string | null;
  meter_reading: string | null;
  downtime_hours: string | null;
  vendor_name: string | null;
  expense_id: string | null;
  has_bill: boolean;
}

export interface EquipmentDocument {
  id: string;
  equipment_id: string;
  kind: string;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  standing: EquipmentDocumentStandingName;
  note: string | null;
  has_file: boolean;
  url: string | null;
}

export type EquipmentCostKindName = 'hire' | 'mobilisation' | 'operator' | 'charge_out' | 'fuel' | 'maintenance';

export interface EquipmentCostRow extends Record<EquipmentCostKindName, string> {
  equipment: EquipmentRef;
  project: { id: string; name: string } | null;
  total: string;
  counted: string;
  not_counted: string;
  hours_worked: string;
  hours_charged: string;
}

export interface EquipmentCostReport {
  from: string;
  to: string;
  rows: EquipmentCostRow[];
  sites: Array<{ project: { id: string; name: string } | null; total: string; counted: string }>;
  cost_codes: Array<{
    project: { id: string; name: string } | null;
    cost_code: { id: string; code: string; name: string } | null;
    total: string;
    counted: string;
  }>;
  totals: Record<EquipmentCostKindName, string> & { total: string; counted: string; not_counted: string };
}

export interface EquipmentUtilisationRow {
  equipment: EquipmentRef & { category: string; ownership: string };
  days_on_site: number;
  hours_worked: string;
  hours_idle: string;
  hours_breakdown: string;
  hours_available: string;
  utilisation_percent: number | null;
  breakdown_percent: number | null;
  fuel_litres: string;
  fuel_per_hour: number | null;
}

export interface EquipmentUtilisationReport {
  from: string;
  to: string;
  rows: EquipmentUtilisationRow[];
}

export interface EquipmentFuelReport {
  from: string;
  to: string;
  threshold_percent: number;
  machines: Array<{ equipment: EquipmentRef; litres: string; hours_worked: string; fuel_per_hour: number | null; days: number }>;
  outliers: Array<{
    equipment: EquipmentRef;
    project: { id: string; name: string };
    date: string;
    litres: string;
    hours_worked: string;
    fuel_per_hour: number;
    usual_per_hour: number;
    above_percent: number;
  }>;
}

export interface EquipmentDetail extends EquipmentSummary {
  allocations: Array<{
    id: string;
    project: { id: string; name: string };
    cost_code: { id: string; code: string; name: string } | null;
    from_date: string | null;
    to_date: string | null;
    note: string | null;
  }>;
  service_plans: EquipmentServicePlan[];
  logs: EquipmentLog[];
  maintenance: EquipmentMaintenanceRecord[];
  documents: EquipmentDocument[];
  cost: EquipmentCostReport | null;
  utilisation: EquipmentUtilisationRow | null;
  created_on: string;
}

export interface EquipmentBoard {
  date: string;
  sites: Array<{
    project_id: string;
    project_name: string;
    machines: Array<{
      id: string;
      code: string;
      name: string;
      category: string;
      ownership: string;
      status: string;
      meter_type: string;
      meter_reading: string | null;
      since: string | null;
      logged_today: boolean;
      hours_today: string | null;
    }>;
  }>;
}

export interface EquipmentDue {
  date: string;
  services: Array<EquipmentServicePlan & { equipment: EquipmentRef; meter_reading: string | null }>;
  documents: Array<{
    id: string;
    equipment: EquipmentRef;
    kind: string;
    number: string | null;
    expires_on: string | null;
    standing: EquipmentDocumentStandingName;
  }>;
}

export interface EquipmentHireStatement {
  vendor: { id: string; name: string };
  month: string;
  from: string;
  to: string;
  rows: Array<{
    equipment: EquipmentRef;
    project: { id: string; name: string } | null;
    hire_basis: string | null;
    rate: string;
    min_hours: string | null;
    days: number;
    hours_worked: string;
    hours_charged: string;
    minimum_top_up: string;
    extra_hours: string;
    hire: string;
    operator: string;
    mobilisation: string;
    total: string;
    cost_code_id: string | null;
    booked: { expense_id: string; invoice_ref: string | null; amount: string } | null;
  }>;
  total: string;
  booked_total: string;
}

export interface EquipmentMeterScan {
  reading: string | null;
  unit: 'hours' | 'km' | null;
}

export interface EquipmentFuelBillScan {
  litres: string | null;
  amount: string | null;
  issued_on: string | null;
  vendor: string | null;
  unread: string[];
}
