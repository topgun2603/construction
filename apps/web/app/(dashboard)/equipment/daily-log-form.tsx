'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Fuel, Loader2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { EQUIPMENT_FUEL_SOURCE_LABELS, EQUIPMENT_FUEL_SOURCES, type EquipmentFuelSource } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { logEquipmentDay, scanEquipmentFuelBill, scanEquipmentMeter } from '@/lib/equipment-actions';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import { CheckRow, ChoiceField } from './fields';
import { uploadEquipmentPhoto } from './photo-upload';

const HOURS = /^\d{1,8}(\.\d)?$/;
const LITRES = /^\d{1,7}(\.\d{1,2})?$/;

export interface LogMachine {
  id: string;
  code: string;
  name: string;
  meter_type: 'hours' | 'km' | 'none';
  meter_reading: string | null;
  fuel_included: boolean;
  site: { id: string; name: string } | null;
}

/**
 * The end-of-shift log, built for a phone in one hand: pick the machine, photograph the meter (read
 * by the AI where it is switched on, typed where not — the person always confirms the number), the
 * hours, who drove it, and any diesel issued with a photo of the slip.
 *
 * The site is never asked for: it is wherever the machine was allocated that day, so the hours and
 * their cost cannot be put on the wrong job.
 */
export function DailyLogForm({
  machines,
  workers,
  materials,
  fixedMachineId,
  canRecordExpense,
}: {
  machines: LogMachine[];
  workers: Array<{ id: string; name: string }>;
  materials: Array<{ id: string; name: string; unit: string }>;
  fixedMachineId?: string;
  canRecordExpense: boolean;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [machineId, setMachineId] = useState(fixedMachineId ?? machines[0]?.id ?? '');
  const machine = useMemo(() => machines.find((row) => row.id === machineId) ?? null, [machines, machineId]);
  const [date, setDate] = useState(format.todayIso());
  const [opening, setOpening] = useState(machine?.meter_reading ?? '');
  const [closing, setClosing] = useState('');
  const [worked, setWorked] = useState('');
  const [idle, setIdle] = useState('');
  const [breakdown, setBreakdown] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [workDone, setWorkDone] = useState('');
  const [meterKey, setMeterKey] = useState<string | null>(null);
  const [withFuel, setWithFuel] = useState(false);
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<EquipmentFuelSource>(machine?.fuel_included ? 'vendor' : 'direct');
  const [materialId, setMaterialId] = useState(materials.find((m) => /diesel|hsd/i.test(m.name))?.id ?? '');
  const [billKey, setBillKey] = useState<string | null>(null);
  const [reading, setReading] = useState<'meter' | 'bill' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const meterType = machine?.meter_type ?? 'none';
  const unit = meterType === 'km' ? 'km' : 'h';
  const hoursFromMeter =
    meterType === 'hours' && HOURS.test(opening) && HOURS.test(closing) && Number(closing) >= Number(opening)
      ? (Math.round((Number(closing) - Number(opening)) * 10) / 10).toString()
      : null;

  function pickMachine(id: string) {
    setMachineId(id);
    const next = machines.find((row) => row.id === id);
    setOpening(next?.meter_reading ?? '');
    setClosing('');
    setSource(next?.fuel_included ? 'vendor' : 'direct');
  }

  async function readMeter(file: File) {
    setError(null);
    setReading('meter');
    const uploaded = await uploadEquipmentPhoto(file, machine?.site?.id);
    if (!uploaded.ok) {
      setReading(null);
      return setError(t(uploaded.error));
    }
    setMeterKey(uploaded.key);
    const scan = await scanEquipmentMeter(uploaded.key);
    setReading(null);
    if (scan.ok && scan.data?.reading) {
      setClosing(scan.data.reading);
      toast.success(`${t('Read')} ${scan.data.reading} ${unit} — ${t('check it against the dial')}`);
    } else {
      toast.message(t('Photo saved. Type the reading from the dial.'));
    }
  }

  async function readBill(file: File) {
    setError(null);
    setReading('bill');
    const uploaded = await uploadEquipmentPhoto(file, machine?.site?.id);
    if (!uploaded.ok) {
      setReading(null);
      return setError(t(uploaded.error));
    }
    setBillKey(uploaded.key);
    const scan = await scanEquipmentFuelBill(uploaded.key);
    setReading(null);
    if (scan.ok && scan.data) {
      if (scan.data.litres) setLitres(scan.data.litres);
      if (scan.data.amount) setAmount(minorToAmountInput(scan.data.amount, format.currencyDigits));
      if (scan.data.issued_on) setDate(scan.data.issued_on);
      toast.success(t('Read from the slip — check the litres and the amount'));
    } else {
      toast.message(t('Slip saved. Type the litres and the amount.'));
    }
  }

  function submit() {
    setError(null);
    if (!machine) return setError(t('Choose the machine'));
    if (!machine.site) return setError(t('This machine is not on a site. Allocate it first.'));
    if (meterType !== 'none') {
      if (!HOURS.test(opening) || !HOURS.test(closing)) return setError(t('Enter the opening and closing readings'));
      if (Number(closing) < Number(opening)) return setError(t('The closing reading is below the opening reading'));
    }
    if (meterType !== 'hours' && !HOURS.test(worked)) return setError(t('Enter the hours worked'));
    for (const value of [idle, breakdown]) {
      if (value && !HOURS.test(value)) return setError(t('Enter hours as numbers, like 1.5'));
    }
    const total =
      Number(hoursFromMeter ?? worked ?? 0) + Number(idle || 0) + Number(breakdown || 0);
    if (total > 24) return setError(t('Worked, idle and breakdown hours add up to more than 24'));

    let fuel: Parameters<typeof logEquipmentDay>[0]['fuel'];
    if (withFuel) {
      if (!LITRES.test(litres) || Number(litres) <= 0) return setError(t('Enter the litres issued'));
      let minor = '0';
      try {
        minor = amountToMinorString(amount, format.currencyDigits, format.currencySymbol);
      } catch {
        return setError(t('Enter the amount as a number, like 4500'));
      }
      if (source === 'stock' && !materialId) return setError(t('Pick which material in stock is the diesel'));
      if (source === 'expense' && minor === '0') return setError(t('Enter what the fuel cost'));
      fuel = {
        litres,
        source,
        ...(source !== 'vendor' && minor !== '0' ? { amount: minor } : {}),
        ...(source === 'stock' ? { material_id: materialId } : {}),
        ...(source === 'expense' ? { create_expense: true } : {}),
        ...(billKey ? { bill_s3_key: billKey } : {}),
      };
    }

    start(async () => {
      const result = await logEquipmentDay({
        equipment_id: machine.id,
        log_date: date,
        ...(meterType !== 'none' ? { opening_meter: opening, closing_meter: closing } : {}),
        ...(meterType !== 'hours' ? { hours_worked: worked } : {}),
        ...(idle ? { idle_hours: idle } : {}),
        ...(breakdown ? { breakdown_hours: breakdown } : {}),
        ...(operatorId ? { operator_worker_id: operatorId } : operatorName ? { operator_name: operatorName } : {}),
        ...(meterKey ? { meter_photo_key: meterKey } : {}),
        work_done: workDone.trim() || null,
        ...(fuel ? { fuel } : {}),
        client_id: crypto.randomUUID(),
      });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not save the log'));
      toast.success(`${machine.code}: ${result.data.hours_worked} ${t('h on')} ${result.data.project.name}`);
      setOpening(closing);
      setClosing('');
      setWorked('');
      setIdle('');
      setBreakdown('');
      setWorkDone('');
      setMeterKey(null);
      setWithFuel(false);
      setLitres('');
      setAmount('');
      setBillKey(null);
      router.refresh();
    });
  }

  const sourceOptions = EQUIPMENT_FUEL_SOURCES.filter((value) => value !== 'expense' || canRecordExpense).map((value) => ({
    value,
    label: EQUIPMENT_FUEL_SOURCE_LABELS[value],
  }));

  return (
    <div className="flex flex-col gap-4">
      {!fixedMachineId && (
        <ChoiceField
          label={t('Machine')}
          value={machineId}
          onChange={pickMachine}
          translate={false}
          options={machines.map((row) => ({
            value: row.id,
            label: `${row.code} · ${row.name}${row.site ? ` — ${row.site.name}` : ''}`,
          }))}
        />
      )}
      {machine && (
        <p className="text-[13px] text-ink-muted">
          {machine.site ? `${t('On')} ${machine.site.name}` : t('Not on a site')}
          {machine.meter_reading ? ` · ${t('last reading')} ${machine.meter_reading} ${unit}` : ''}
        </p>
      )}
      <Field label={t('Date')} htmlFor="log-date">
        <Input id="log-date" type="date" value={date} max={format.todayIso()} onChange={(event) => setDate(event.target.value)} />
      </Field>

      {meterType !== 'none' && (
        <Card className="flex flex-col gap-3 p-3">
          <label className="flex h-20 cursor-pointer items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong bg-raised text-[13.5px] text-ink-muted">
            {reading === 'meter' ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
            {meterKey ? t('Meter photo saved — take another') : t('Photograph the meter')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readMeter(file);
              }}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t('Opening')} (${unit})`} htmlFor="log-open">
              <Input id="log-open" inputMode="decimal" value={opening} onChange={(event) => setOpening(event.target.value)} dir="ltr" />
            </Field>
            <Field label={`${t('Closing')} (${unit})`} htmlFor="log-close">
              <Input id="log-close" inputMode="decimal" value={closing} onChange={(event) => setClosing(event.target.value)} dir="ltr" />
            </Field>
          </div>
          {hoursFromMeter !== null && (
            <p className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              <ScanLine className="size-4" /> {hoursFromMeter} {t('hours worked, from the meter')}
            </p>
          )}
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        {meterType !== 'hours' && (
          <Field label={t('Worked (h)')} htmlFor="log-worked">
            <Input id="log-worked" inputMode="decimal" value={worked} onChange={(event) => setWorked(event.target.value)} dir="ltr" />
          </Field>
        )}
        <Field label={t('Idle (h)')} htmlFor="log-idle" optional>
          <Input id="log-idle" inputMode="decimal" value={idle} onChange={(event) => setIdle(event.target.value)} dir="ltr" />
        </Field>
        <Field label={t('Breakdown (h)')} htmlFor="log-breakdown" optional>
          <Input id="log-breakdown" inputMode="decimal" value={breakdown} onChange={(event) => setBreakdown(event.target.value)} dir="ltr" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceField
          label={t('Operator')}
          value={operatorId}
          onChange={setOperatorId}
          optional
          translate={false}
          placeholder={t('From the roster')}
          options={workers.map((worker) => ({ value: worker.id, label: worker.name }))}
        />
        {!operatorId && (
          <Field label={t('Or their name')} htmlFor="log-operator" optional>
            <Input id="log-operator" value={operatorName} maxLength={120} onChange={(event) => setOperatorName(event.target.value)} />
          </Field>
        )}
      </div>
      <Field label={t('Work done')} htmlFor="log-work" optional>
        <Textarea
          id="log-work"
          rows={2}
          maxLength={1000}
          value={workDone}
          onChange={(event) => setWorkDone(event.target.value)}
          placeholder={t('Excavation for footings, block B')}
        />
      </Field>

      <CheckRow label={t('Fuel issued today')} checked={withFuel} onChange={setWithFuel} />
      {withFuel && (
        <Card className="flex flex-col gap-3 p-3">
          <label className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong bg-raised text-[13.5px] text-ink-muted">
            {reading === 'bill' ? <Loader2 className="size-5 animate-spin" /> : <Fuel className="size-5" />}
            {billKey ? t('Slip saved — take another') : t('Photograph the fuel slip')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readBill(file);
              }}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Litres')} htmlFor="fuel-litres">
              <Input id="fuel-litres" inputMode="decimal" value={litres} onChange={(event) => setLitres(event.target.value)} dir="ltr" />
            </Field>
            {source !== 'vendor' && (
              <Field label={`${t('Amount')} (${format.currencySymbol})`} htmlFor="fuel-amount" optional={source !== 'expense'}>
                <Input id="fuel-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} dir="ltr" />
              </Field>
            )}
          </div>
          <ChoiceField
            label={t('Where the diesel came from')}
            value={source}
            onChange={(value) => setSource(value as EquipmentFuelSource)}
            options={sourceOptions}
          />
          {source === 'stock' && (
            <ChoiceField
              label={t('Material in stock')}
              value={materialId}
              onChange={setMaterialId}
              translate={false}
              options={materials.map((material) => ({ value: material.id, label: `${material.name} (${material.unit})` }))}
            />
          )}
          {source === 'expense' && (
            <p className="text-[12.5px] text-ink-muted">{t('Recorded as a fuel expense on the site, for approval like any other.')}</p>
          )}
        </Card>
      )}

      {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
      <Button type="button" size="lg" className="w-full" onClick={submit} disabled={pending || reading !== null}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t('Save the day’s log')}
      </Button>
    </div>
  );
}
