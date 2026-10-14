'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, FileText, Loader2, LogOut, MapPin, Plus, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { EQUIPMENT_DOCUMENT_KINDS, EQUIPMENT_DOCUMENT_LABELS } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { costCodeOptions } from '@/lib/cost-code-actions';
import type { CostCode } from '@/lib/cost-code-types';
import {
  addEquipmentDocument,
  addEquipmentServicePlan,
  allocateEquipment,
  recordEquipmentMaintenance,
  releaseEquipment,
  removeEquipmentDocument,
} from '@/lib/equipment-actions';
import type { EquipmentServicePlan } from '@/lib/equipment-types';
import { amountToMinorString } from '@/lib/money-input';
import { CheckRow, ChoiceField } from '../fields';
import { uploadEquipmentPhoto } from '../photo-upload';

const DECIMAL = /^\d{1,8}(\.\d)?$/;

type Site = { id: string; name: string };

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return { router, error, setError, pending, start };
}

/** Put the machine on a site from a date — moving it closes the site it was on the day before. */
export function AllocateDialog({ machineId, sites, currentSiteId }: { machineId: string; sites: Site[]; currentSiteId?: string }) {
  const { t } = useLanguage();
  const format = useFormat();
  const { router, error, setError, pending, start } = useSubmit();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [codeId, setCodeId] = useState('');
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [from, setFrom] = useState(format.todayIso());

  useEffect(() => {
    if (!open || !siteId) return setCodes([]);
    let live = true;
    void costCodeOptions(siteId).then((result) => {
      if (live) setCodes(result.ok ? (result.data ?? []) : []);
    });
    return () => {
      live = false;
    };
  }, [open, siteId]);

  function submit() {
    setError(null);
    if (!siteId) return setError(t('Choose the site'));
    start(async () => {
      const result = await allocateEquipment(machineId, {
        project_id: siteId,
        from_date: from,
        ...(codeId ? { cost_code_id: codeId } : {}),
      });
      if (!result.ok) return setError(result.error ?? t('Could not move the machine'));
      toast.success(t('Machine allocated'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MapPin className="size-4" />
          {currentSiteId ? t('Move to another site') : t('Allocate to a site')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{currentSiteId ? t('Move to another site') : t('Allocate to a site')}</DialogTitle>
          <DialogDescription>{t('Its hours and cost land on this site from this date.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <ChoiceField
            label={t('Site')}
            value={siteId}
            onChange={setSiteId}
            translate={false}
            options={sites.filter((site) => site.id !== currentSiteId).map((site) => ({ value: site.id, label: site.name }))}
          />
          <Field label={t('From')} htmlFor="alloc-from">
            <Input id="alloc-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          {codes.length > 0 && (
            <ChoiceField
              label={t('Cost code')}
              value={codeId}
              onChange={setCodeId}
              optional
              translate={false}
              options={codes.map((code) => ({ value: code.id, label: `${code.code} · ${code.name}` }))}
            />
          )}
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Allocate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Take the machine off its site: back to the yard, or back to the vendor. */
export function ReleaseDialog({ machineId, ownership, projectId }: { machineId: string; ownership: string; projectId: string }) {
  const { t } = useLanguage();
  const format = useFormat();
  const { router, error, setError, pending, start } = useSubmit();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(format.todayIso());
  const [status, setStatus] = useState<'available' | 'off_hire'>(ownership === 'hired' ? 'off_hire' : 'available');

  function submit() {
    setError(null);
    start(async () => {
      const result = await releaseEquipment(machineId, { to_date: to, status }, projectId);
      if (!result.ok) return setError(result.error ?? t('Could not release the machine'));
      toast.success(t('Machine released'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <LogOut className="size-4 rtl:rotate-180" />
          {t('Release from site')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Release from site')}</DialogTitle>
          <DialogDescription>{t('The last day it was on the site. Hire stops counting after it.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t('Last day on site')} htmlFor="release-to">
            <Input id="release-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <ChoiceField
            label={t('Then')}
            value={status}
            onChange={(value) => setStatus(value as typeof status)}
            options={[
              { value: 'available', label: 'Back to the yard' },
              { value: 'off_hire', label: 'Off hire — back to the vendor' },
            ]}
          />
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Release')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A service or a repair, optionally recorded as an expense on the site that pays for it. */
export function MaintenanceDialog({
  machineId,
  plans,
  canRecordExpense,
  meterUnit,
}: {
  machineId: string;
  plans: EquipmentServicePlan[];
  canRecordExpense: boolean;
  meterUnit: string;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const { router, error, setError, pending, start } = useSubmit();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'preventive' | 'breakdown'>('preventive');
  const [planId, setPlanId] = useState('');
  const [where, setWhere] = useState<'site' | 'yard'>('site');
  const [asExpense, setAsExpense] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!read('description')) return setError(t('Say what was done'));
    for (const name of ['meter_reading', 'downtime_hours']) {
      if (read(name) && !DECIMAL.test(read(name))) return setError(t('Enter readings and hours as numbers, like 1250.5'));
    }
    let cost: string;
    try {
      cost = amountToMinorString(read('cost'), format.currencyDigits, format.currencySymbol);
    } catch {
      return setError(t('Enter the cost as a number, like 2500'));
    }
    start(async () => {
      const result = await recordEquipmentMaintenance(machineId, {
        done_on: read('done_on'),
        kind,
        description: read('description'),
        parts: read('parts') || null,
        cost,
        meter_reading: read('meter_reading') || null,
        downtime_hours: read('downtime_hours') || null,
        vendor_name: read('vendor_name') || null,
        ...(planId ? { plan_id: planId } : {}),
        ...(where === 'yard' ? { project_id: null } : {}),
        ...(asExpense && where === 'site' ? { create_expense: true } : {}),
      });
      if (!result.ok) return setError(result.error ?? t('Could not save it'));
      toast.success(kind === 'preventive' ? t('Service recorded') : t('Repair recorded'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Wrench className="size-4" />
          {t('Record service or repair')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Record service or repair')}</DialogTitle>
          <DialogDescription>{t('What was done, what it cost and how long the machine was out.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Date')} htmlFor="mnt-date">
              <Input id="mnt-date" name="done_on" type="date" defaultValue={format.todayIso()} max={format.todayIso()} />
            </Field>
            <ChoiceField
              label={t('Kind')}
              value={kind}
              onChange={(value) => setKind(value as typeof kind)}
              options={[
                { value: 'preventive', label: 'Service (preventive)' },
                { value: 'breakdown', label: 'Breakdown repair' },
              ]}
            />
          </div>
          {plans.length > 0 && (
            <ChoiceField
              label={t('Service plan carried out')}
              value={planId}
              onChange={setPlanId}
              optional
              translate={false}
              options={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
            />
          )}
          <Field label={t('What was done')} htmlFor="mnt-desc">
            <Input id="mnt-desc" name="description" maxLength={500} placeholder={t('Hydraulic hose replaced')} />
          </Field>
          <Field label={t('Parts')} htmlFor="mnt-parts" optional>
            <Textarea id="mnt-parts" name="parts" rows={2} maxLength={1000} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={`${t('Cost')} (${format.currencySymbol})`} htmlFor="mnt-cost" optional>
              <Input id="mnt-cost" name="cost" inputMode="decimal" dir="ltr" />
            </Field>
            <Field label={`${t('Meter')} (${meterUnit})`} htmlFor="mnt-meter" optional>
              <Input id="mnt-meter" name="meter_reading" inputMode="decimal" dir="ltr" />
            </Field>
            <Field label={t('Downtime (h)')} htmlFor="mnt-down" optional>
              <Input id="mnt-down" name="downtime_hours" inputMode="decimal" dir="ltr" />
            </Field>
          </div>
          <Field label={t('Workshop or mechanic')} htmlFor="mnt-vendor" optional>
            <Input id="mnt-vendor" name="vendor_name" maxLength={120} />
          </Field>
          <ChoiceField
            label={t('Who pays')}
            value={where}
            onChange={(value) => setWhere(value as typeof where)}
            options={[
              { value: 'site', label: 'The site it was on that day' },
              { value: 'yard', label: 'The yard — no site' },
            ]}
          />
          {where === 'site' && canRecordExpense && (
            <CheckRow label={t('Also record it as an expense on the site')} checked={asExpense} onChange={setAsExpense} />
          )}
          {where === 'site' && (
            <p className="text-[12.5px] text-ink-muted">
              {asExpense
                ? t('The expense carries the cost into the site’s accounts; equipment will not count it again.')
                : t('Equipment puts the cost on the site’s actual cost. Do not record it as an expense as well.')}
            </p>
          )}
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A service schedule: every so many hours or km, every so many days, or both. */
export function ServicePlanDialog({ machineId, meterType }: { machineId: string; meterType: string }) {
  const { t } = useLanguage();
  const { router, error, setError, pending, start } = useSubmit();
  const [open, setOpen] = useState(false);
  const unit = meterType === 'km' ? 'km' : t('hours');

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    const meter = read('interval_meter');
    const days = read('interval_days');
    if (!meter && !days) return setError(t('Set an interval in hours, km or days'));
    if ((meter && !DECIMAL.test(meter)) || (read('last_done_meter') && !DECIMAL.test(read('last_done_meter')))) {
      return setError(t('Enter readings as numbers, like 250'));
    }
    start(async () => {
      const result = await addEquipmentServicePlan(machineId, {
        name: read('name') || t('Service'),
        ...(meter ? { interval_meter: meter } : {}),
        ...(days ? { interval_days: Number(days) } : {}),
        ...(read('last_done_meter') ? { last_done_meter: read('last_done_meter') } : {}),
        ...(read('last_done_on') ? { last_done_on: read('last_done_on') } : {}),
      });
      if (!result.ok) return setError(result.error ?? t('Could not save the plan'));
      toast.success(t('Service plan added'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <CalendarClock className="size-4" />
          {t('Add service plan')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Add service plan')}</DialogTitle>
          <DialogDescription>{t('Whichever interval comes first makes it due. Reminders go out on your company’s clock.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Name')} htmlFor="plan-name">
            <Input id="plan-name" name="name" maxLength={120} placeholder={t('250 h service')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {meterType !== 'none' && (
              <Field label={`${t('Every')} (${unit})`} htmlFor="plan-meter" optional>
                <Input id="plan-meter" name="interval_meter" inputMode="decimal" placeholder="250" dir="ltr" />
              </Field>
            )}
            <Field label={`${t('Every')} (${t('days')})`} htmlFor="plan-days" optional>
              <Input id="plan-days" name="interval_days" type="number" min={1} max={3650} />
            </Field>
            {meterType !== 'none' && (
              <Field label={t('Last done at')} htmlFor="plan-last-meter" optional hint={t('Left empty: the reading now')}>
                <Input id="plan-last-meter" name="last_done_meter" inputMode="decimal" dir="ltr" />
              </Field>
            )}
            <Field label={t('Last done on')} htmlFor="plan-last-on" optional hint={t('Left empty: today')}>
              <Input id="plan-last-on" name="last_done_on" type="date" />
            </Field>
          </div>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Add plan')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Insurance, fitness, registration, an operator's licence — with the expiry that gets reminded. */
export function DocumentDialog({ machineId }: { machineId: string }) {
  const { t } = useLanguage();
  const { router, error, setError, pending, start } = useSubmit();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>('insurance');
  const [file, setFile] = useState<File | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    start(async () => {
      let key: string | undefined;
      if (file) {
        const uploaded = await uploadEquipmentPhoto(file);
        if (!uploaded.ok) return setError(t(uploaded.error));
        key = uploaded.key;
      }
      const result = await addEquipmentDocument(machineId, {
        kind: kind as (typeof EQUIPMENT_DOCUMENT_KINDS)[number],
        ...(read('number') ? { number: read('number') } : {}),
        ...(read('issued_on') ? { issued_on: read('issued_on') } : {}),
        ...(read('expires_on') ? { expires_on: read('expires_on') } : {}),
        ...(key ? { s3_key: key } : {}),
      });
      if (!result.ok) return setError(result.error ?? t('Could not save the document'));
      toast.success(t('Document added'));
      setOpen(false);
      setFile(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <FileText className="size-4" />
          {t('Add document')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Add document')}</DialogTitle>
          <DialogDescription>{t('You are reminded 30 days before it expires.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <ChoiceField
            label={t('Document')}
            value={kind}
            onChange={setKind}
            options={EQUIPMENT_DOCUMENT_KINDS.map((value) => ({ value, label: EQUIPMENT_DOCUMENT_LABELS[value] }))}
          />
          <Field label={t('Number')} htmlFor="doc-number" optional>
            <Input id="doc-number" name="number" maxLength={80} dir="ltr" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Issued')} htmlFor="doc-issued" optional>
              <Input id="doc-issued" name="issued_on" type="date" />
            </Field>
            <Field label={t('Expires')} htmlFor="doc-expires" optional>
              <Input id="doc-expires" name="expires_on" type="date" />
            </Field>
          </div>
          <Field label={t('Scan or photo')} htmlFor="doc-file" optional>
            <Input
              id="doc-file"
              type="file"
              accept="image/*,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              <Plus className="size-4" />
              {t('Add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveDocumentButton({ machineId, documentId }: { machineId: string; documentId: string }) {
  const { t } = useLanguage();
  const { router, pending, start } = useSubmit();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={t('Remove')}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await removeEquipmentDocument(machineId, documentId);
          if (!result.ok) toast.error(result.error ?? t('Could not remove it'));
          else router.refresh();
        })
      }
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
