'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS } from '@sitebook/shared';
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
import { createEquipment, updateEquipment, type EquipmentFormInput } from '@/lib/equipment-actions';
import type { EquipmentSummary } from '@/lib/equipment-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import { CheckRow, ChoiceField } from './fields';

const HOURS = /^\d{1,8}(\.\d)?$/;

/**
 * Register a machine, or edit one. Owned kit carries the internal rate it charges a site; hired kit
 * carries the vendor's terms — rate, minimum hours, operator, fuel, mobilisation — which the hire
 * statement and the cost report are worked out from.
 */
export function EquipmentDialog({
  vendors,
  initial,
}: {
  vendors: Array<{ id: string; name: string }>;
  /** Editing this machine; creating when left out. */
  initial?: EquipmentSummary;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const money = (value: string | null | undefined) => (value ? minorToAmountInput(value, format.currencyDigits) : '');
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(initial?.category ?? 'backhoe');
  const [ownership, setOwnership] = useState<'owned' | 'hired'>(initial?.ownership ?? 'owned');
  const [vendorId, setVendorId] = useState(initial?.vendor?.id ?? '');
  const [hireBasis, setHireBasis] = useState<'hour' | 'day' | 'month'>(initial?.hire_basis ?? 'hour');
  const [chargeBasis, setChargeBasis] = useState<'hour' | 'day'>(initial?.charge_out_basis ?? 'hour');
  const [meterType, setMeterType] = useState<'hours' | 'km' | 'none'>(initial?.meter_type ?? 'hours');
  const [operatorIncluded, setOperatorIncluded] = useState(initial?.operator_included ?? true);
  const [fuelIncluded, setFuelIncluded] = useState(initial?.fuel_included ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    const amount = (name: string) => amountToMinorString(read(name), format.currencyDigits, format.currencySymbol);
    if (!read('name')) return setError(t('Give the machine a name'));
    if (ownership === 'hired' && !vendorId) return setError(t('Choose the vendor it is hired from'));
    const minHours = read('min_hours');
    const reading = read('meter_reading');
    if (minHours && !HOURS.test(minHours)) return setError(t('Enter the minimum hours as a number, like 8'));
    if (reading && !HOURS.test(reading)) return setError(t('Enter the meter reading as a number, like 1250.5'));
    let input: EquipmentFormInput;
    try {
      input = {
        name: read('name'),
        category,
        ...(read('code') ? { code: read('code') } : {}),
        make: read('make') || null,
        model: read('model') || null,
        registration_no: read('registration_no') || null,
        serial_no: read('serial_no') || null,
        quantity: Number(read('quantity') || '1') || 1,
        ownership,
        meter_type: meterType,
        meter_reading: meterType === 'none' ? null : reading || null,
        notes: read('notes') || null,
        ...(ownership === 'hired'
          ? {
              vendor_id: vendorId,
              hire_basis: hireBasis,
              hire_rate: amount('hire_rate'),
              min_hours: hireBasis === 'day' ? null : minHours || null,
              operator_included: operatorIncluded,
              operator_rate: operatorIncluded ? '0' : amount('operator_rate'),
              fuel_included: fuelIncluded,
              mobilisation_charge: amount('mobilisation'),
            }
          : { charge_out_basis: chargeBasis, charge_out_rate: amount('charge_out_rate') }),
      };
    } catch {
      return setError(t('Enter amounts as numbers, like 1200'));
    }
    start(async () => {
      const result = initial ? await updateEquipment(initial.id, input) : await createEquipment(input);
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not save the machine'));
      toast.success(`${result.data.code} · ${result.data.name}`);
      setOpen(false);
      if (!initial) router.push(`/equipment/${result.data.id}`);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <Button size="sm" variant="secondary">
            <Pencil className="size-4" />
            {t('Edit')}
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" />
            {t('Add machine')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `${t('Edit')} ${initial.code}` : t('Add a machine')}</DialogTitle>
          <DialogDescription>
            {t('Owned or hired. Hire terms are what the vendor’s invoice is checked against.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Name')} htmlFor="eq-name">
              <Input id="eq-name" name="name" defaultValue={initial?.name} maxLength={120} placeholder={t('JCB 3DX')} required />
            </Field>
            <ChoiceField
              label={t('Category')}
              value={category}
              onChange={setCategory}
              options={EQUIPMENT_CATEGORIES.map((value) => ({ value, label: EQUIPMENT_CATEGORY_LABELS[value] }))}
            />
            <Field label={t('Asset code')} htmlFor="eq-code" optional hint={t('Left empty, one is suggested')}>
              <Input id="eq-code" name="code" defaultValue={initial?.code} maxLength={40} placeholder="BH-004" />
            </Field>
            <Field label={t('Quantity')} htmlFor="eq-qty" hint={t('For scaffolding sets or tools in bulk')}>
              <Input id="eq-qty" name="quantity" type="number" min={1} defaultValue={initial?.quantity ?? 1} />
            </Field>
            <Field label={t('Make')} htmlFor="eq-make" optional>
              <Input id="eq-make" name="make" defaultValue={initial?.make ?? ''} maxLength={80} />
            </Field>
            <Field label={t('Model')} htmlFor="eq-model" optional>
              <Input id="eq-model" name="model" defaultValue={initial?.model ?? ''} maxLength={80} />
            </Field>
            <Field label={t('Registration number')} htmlFor="eq-reg" optional>
              <Input id="eq-reg" name="registration_no" defaultValue={initial?.registration_no ?? ''} maxLength={40} dir="ltr" />
            </Field>
            <Field label={t('Serial number')} htmlFor="eq-serial" optional>
              <Input id="eq-serial" name="serial_no" defaultValue={initial?.serial_no ?? ''} maxLength={80} dir="ltr" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceField
              label={t('Meter')}
              value={meterType}
              onChange={(value) => setMeterType(value as typeof meterType)}
              options={[
                { value: 'hours', label: 'Hour meter' },
                { value: 'km', label: 'Odometer (km)' },
                { value: 'none', label: 'No meter' },
              ]}
            />
            {meterType !== 'none' && (
              <Field label={t('Current reading')} htmlFor="eq-reading" optional>
                <Input id="eq-reading" name="meter_reading" inputMode="decimal" defaultValue={initial?.meter_reading ?? ''} dir="ltr" />
              </Field>
            )}
          </div>

          <div className="flex gap-2">
            {(['owned', 'hired'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={ownership === value ? 'primary' : 'secondary'}
                onClick={() => setOwnership(value)}
              >
                {value === 'owned' ? t('Owned') : t('Hired')}
              </Button>
            ))}
          </div>

          {ownership === 'hired' ? (
            <div className="grid gap-3 rounded-panel border border-line p-3 sm:grid-cols-2">
              <ChoiceField
                label={t('Vendor')}
                value={vendorId}
                onChange={setVendorId}
                translate={false}
                placeholder={vendors.length === 0 ? t('Add the vendor in Procurement first') : t('Choose')}
                options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
              />
              <ChoiceField
                label={t('Charged')}
                value={hireBasis}
                onChange={(value) => setHireBasis(value as typeof hireBasis)}
                options={[
                  { value: 'hour', label: 'By the hour' },
                  { value: 'day', label: 'By the day' },
                  { value: 'month', label: 'By the month' },
                ]}
              />
              <Field label={`${t('Rate')} (${format.currencySymbol})`} htmlFor="eq-rate">
                <Input id="eq-rate" name="hire_rate" inputMode="decimal" defaultValue={money(initial?.hire_rate)} dir="ltr" />
              </Field>
              {hireBasis !== 'day' && (
                <Field
                  label={hireBasis === 'hour' ? t('Minimum hours a day') : t('Hours the monthly rate covers')}
                  htmlFor="eq-min"
                  optional
                >
                  <Input id="eq-min" name="min_hours" inputMode="decimal" defaultValue={initial?.min_hours ?? ''} dir="ltr" />
                </Field>
              )}
              <Field label={`${t('Mobilisation charge')} (${format.currencySymbol})`} htmlFor="eq-mob" optional>
                <Input id="eq-mob" name="mobilisation" inputMode="decimal" defaultValue={money(initial?.mobilisation_charge)} dir="ltr" />
              </Field>
              <div className="flex flex-col justify-end gap-2">
                <CheckRow label={t('Operator included')} checked={operatorIncluded} onChange={setOperatorIncluded} />
                <CheckRow label={t('Fuel included')} checked={fuelIncluded} onChange={setFuelIncluded} />
              </div>
              {!operatorIncluded && (
                <Field label={`${t('Operator, per working day')} (${format.currencySymbol})`} htmlFor="eq-op" optional>
                  <Input id="eq-op" name="operator_rate" inputMode="decimal" defaultValue={money(initial?.operator_rate)} dir="ltr" />
                </Field>
              )}
            </div>
          ) : (
            <div className="grid gap-3 rounded-panel border border-line p-3 sm:grid-cols-2">
              <ChoiceField
                label={t('Charged to the site')}
                value={chargeBasis}
                onChange={(value) => setChargeBasis(value as typeof chargeBasis)}
                options={[
                  { value: 'hour', label: 'Per hour worked' },
                  { value: 'day', label: 'Per day worked' },
                ]}
              />
              <Field
                label={`${t('Internal rate')} (${format.currencySymbol})`}
                htmlFor="eq-charge"
                optional
                hint={t('Owning the machine; fuel and repairs are booked as themselves')}
              >
                <Input id="eq-charge" name="charge_out_rate" inputMode="decimal" defaultValue={money(initial?.charge_out_rate)} dir="ltr" />
              </Field>
            </div>
          )}

          <Field label={t('Notes')} htmlFor="eq-notes" optional>
            <Textarea id="eq-notes" name="notes" rows={2} maxLength={2000} defaultValue={initial?.notes ?? ''} />
          </Field>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {initial ? t('Save') : t('Add machine')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
