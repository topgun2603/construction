'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { priceLine, taxRule } from '@sitebook/shared';
import {
  createPurchaseOrder,
  siteCostCodes,
  updatePurchaseOrder,
} from '@/lib/procurement-actions';
import type { Material, ProjectSummary } from '@/lib/api-types';
import type { CostCode } from '@/lib/cost-code-types';
import type { PurchaseOrder, PurchaseOrderLineInput, Vendor } from '@/lib/procurement-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import { percent, percentToBp } from './status';

const NONE = 'none';

interface LineDraft {
  key: number;
  material_id: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
  tax: string;
  cost_code_id: string;
}

/**
 * Raise a purchase order, or edit a draft.
 *
 * Lines pick from the material catalogue where they can — only those are booked into stock when
 * they arrive — and each carries the site's cost code it commits against. The totals are worked out
 * here with the same function the API uses, so what the buyer sees is what the approver is asked
 * to approve.
 */
export function OrderFormDialog({
  projects,
  vendors,
  materials,
  projectId,
  order,
  trigger,
}: {
  projects: ProjectSummary[];
  vendors: Vendor[];
  materials: Material[];
  projectId?: string;
  /** A draft to edit; omitted to raise a new one. */
  order?: PurchaseOrder;
  trigger?: ReactNode;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const standardRate = taxRule(format.settings.taxRegime ?? 'none').standardRateBp;
  const defaultTax = standardRate === null ? '' : String(standardRate / 100);

  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(order?.project_id ?? projectId ?? projects[0]?.id ?? '');
  const [vendorId, setVendorId] = useState(order?.vendor.id ?? '');
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [lines, setLines] = useState<LineDraft[]>(() => initialLines(order, format.currencyDigits, defaultTax));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !site) return;
    let live = true;
    void siteCostCodes(site).then((result) => {
      if (live) setCodes(result.ok && result.data ? result.data : []);
    });
    return () => {
      live = false;
    };
  }, [open, site]);

  const totals = useMemo(() => {
    let subtotal = 0n;
    let tax = 0n;
    for (const line of lines) {
      const priced = tryPrice(line, format.currencyDigits, format.currencySymbol);
      if (!priced) continue;
      subtotal += priced.amount;
      tax += priced.tax;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, format.currencyDigits, format.currencySymbol]);

  function patch(key: number, change: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  }

  function submit(formData: FormData) {
    setError(null);
    if (!vendorId) return setError(t('Pick a supplier'));
    const built: PurchaseOrderLineInput[] = [];
    for (const [index, line] of lines.entries()) {
      const bp = percentToBp(line.tax);
      let rate: string;
      try {
        rate = amountToMinorString(line.rate, format.currencyDigits, format.currencySymbol);
      } catch {
        return setError(`${t('Line')} ${index + 1}: ${t('the rate is not an amount')}`);
      }
      if (!line.quantity.trim()) return setError(`${t('Line')} ${index + 1}: ${t('enter a quantity')}`);
      if (Number.isNaN(bp)) return setError(`${t('Line')} ${index + 1}: ${t('the tax is not a percentage')}`);
      if (!line.material_id && (!line.description.trim() || !line.unit.trim())) {
        return setError(`${t('Line')} ${index + 1}: ${t('pick a material, or describe it and give a unit')}`);
      }
      built.push({
        material_id: line.material_id || null,
        ...(line.description.trim() ? { description: line.description.trim() } : {}),
        ...(line.unit.trim() ? { unit: line.unit.trim() } : {}),
        quantity: line.quantity.trim(),
        unit_rate: rate,
        tax_rate_bp: bp,
        cost_code_id: line.cost_code_id || null,
      });
    }
    if (built.length === 0) return setError(t('Add at least one line'));

    const notes = String(formData.get('notes') ?? '').trim();
    const delivery = String(formData.get('delivery_address') ?? '').trim();
    const expected = String(formData.get('expected_on') ?? '').trim();

    start(async () => {
      const result = order
        ? await updatePurchaseOrder(order.id, {
            vendor_id: vendorId,
            notes: notes || null,
            delivery_address: delivery || null,
            expected_on: expected || null,
            lines: built,
          })
        : await createPurchaseOrder({
            project_id: site,
            vendor_id: vendorId,
            ...(notes ? { notes } : {}),
            ...(delivery ? { delivery_address: delivery } : {}),
            ...(expected ? { expected_on: expected } : {}),
            lines: built,
          });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the order'));
        return;
      }
      toast.success(order ? t('Order updated') : `${result.data.number} ${t('saved as a draft')}`);
      setOpen(false);
      if (order) router.refresh();
      else router.push(`/procurement/orders/${result.data.id}`);
    });
  }

  const activeVendors = vendors.filter((vendor) => vendor.active || vendor.id === vendorId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-4" />
            {t('New order')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[880px]">
        <DialogHeader>
          <DialogTitle>{order ? `${t('Edit')} ${order.number}` : t('Raise a purchase order')}</DialogTitle>
          <DialogDescription>
            {t('Saved as a draft. Ask for approval when it is right — within your approval limit it is approved at once.')}
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Site')}>
              <Select value={site} onValueChange={setSite} disabled={Boolean(order)}>
                <SelectTrigger aria-label={t('Site')}>
                  <SelectValue placeholder={t('Pick a site')} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('Supplier')}>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger aria-label={t('Supplier')}>
                  <SelectValue placeholder={t('Pick a supplier')} />
                </SelectTrigger>
                <SelectContent>
                  {activeVendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13.5px] font-semibold">{t('Lines')}</span>
            <div className="flex flex-col gap-2">
              {lines.map((line) => {
                const priced = tryPrice(line, format.currencyDigits, format.currencySymbol);
                return (
                  <div
                    key={line.key}
                    className="grid gap-2 rounded-btn border border-line-soft bg-raised p-2.5 sm:grid-cols-[1.6fr_0.7fr_0.8fr_0.5fr_1fr_auto]"
                  >
                    <div className="flex flex-col gap-1.5">
                      <Select
                        value={line.material_id || NONE}
                        onValueChange={(value) => {
                          const material = materials.find((row) => row.id === value);
                          patch(line.key, {
                            material_id: value === NONE ? '' : value,
                            ...(material ? { unit: material.unit, description: '' } : {}),
                          });
                        }}
                      >
                        <SelectTrigger aria-label={t('Material')}>
                          <SelectValue placeholder={t('Material')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t('Not in the catalogue')}</SelectItem>
                          {materials.map((material) => (
                            <SelectItem key={material.id} value={material.id}>
                              {material.name} ({material.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!line.material_id && (
                        <div className="flex gap-1.5">
                          <Input
                            aria-label={t('Description')}
                            placeholder={t('Description')}
                            value={line.description}
                            onChange={(event) => patch(line.key, { description: event.target.value })}
                          />
                          <Input
                            aria-label={t('Unit')}
                            placeholder={t('Unit')}
                            className="w-[80px]"
                            value={line.unit}
                            onChange={(event) => patch(line.key, { unit: event.target.value })}
                          />
                        </div>
                      )}
                    </div>
                    <Input
                      aria-label={t('Quantity')}
                      inputMode="decimal"
                      placeholder={t('Qty')}
                      value={line.quantity}
                      onChange={(event) => patch(line.key, { quantity: event.target.value })}
                    />
                    <Input
                      aria-label={t('Rate')}
                      inputMode="decimal"
                      placeholder={`${t('Rate')} (${format.currencySymbol})`}
                      value={line.rate}
                      onChange={(event) => patch(line.key, { rate: event.target.value })}
                    />
                    <Input
                      aria-label={t('Tax %')}
                      inputMode="decimal"
                      placeholder={t('Tax %')}
                      value={line.tax}
                      onChange={(event) => patch(line.key, { tax: event.target.value })}
                    />
                    <Select
                      value={line.cost_code_id || NONE}
                      onValueChange={(value) => patch(line.key, { cost_code_id: value === NONE ? '' : value })}
                    >
                      <SelectTrigger aria-label={t('Cost code')}>
                        <SelectValue placeholder={t('Cost code')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('No cost code')}</SelectItem>
                        {codes.map((code) => (
                          <SelectItem key={code.id} value={code.id}>
                            {code.code} · {code.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-end gap-2">
                      <span className="min-w-[90px] text-end font-mono text-[13px]">
                        {priced ? format.money(priced.total.toString()) : '—'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('Remove line')}
                        disabled={lines.length === 1}
                        onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setLines((current) => [...current, blankLine(defaultTax)])}
              >
                <Plus className="size-4" /> {t('Add line')}
              </Button>
              <dl className="flex gap-5 text-[13px]">
                <div className="flex gap-1.5">
                  <dt className="text-ink-muted">{t('Subtotal')}</dt>
                  <dd className="font-mono">{format.money(totals.subtotal.toString())}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-ink-muted">{t('Tax')}</dt>
                  <dd className="font-mono">{format.money(totals.tax.toString())}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="font-semibold">{t('Total')}</dt>
                  <dd className="font-mono font-semibold">{format.money(totals.total.toString())}</dd>
                </div>
              </dl>
            </div>
            {standardRate !== null && (
              <p className="text-[12.5px] text-ink-muted">
                {t('Standard rate')}: {percent(standardRate)}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label={t('Deliver to')} optional>
              <Input name="delivery_address" maxLength={500} defaultValue={order?.delivery_address ?? ''} />
            </Field>
            <Field label={t('Expected on')} optional>
              <Input name="expected_on" type="date" defaultValue={order?.expected_on ?? ''} />
            </Field>
          </div>
          <Field label={t('Notes for the supplier')} optional>
            <Textarea name="notes" rows={2} maxLength={2000} defaultValue={order?.notes ?? ''} />
          </Field>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {order ? t('Save draft') : t('Save as draft')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

let nextKey = 1;

function blankLine(tax: string): LineDraft {
  return {
    key: nextKey++,
    material_id: '',
    description: '',
    unit: '',
    quantity: '',
    rate: '',
    tax,
    cost_code_id: '',
  };
}

function initialLines(order: PurchaseOrder | undefined, digits: number, tax: string): LineDraft[] {
  if (!order) return [blankLine(tax)];
  return order.lines.map((line) => ({
    key: nextKey++,
    material_id: line.material_id ?? '',
    description: line.material_id ? '' : line.description,
    unit: line.material_id ? '' : line.unit,
    quantity: line.quantity,
    rate: line.unit_rate === null ? '' : minorToAmountInput(line.unit_rate, digits),
    tax: String(line.tax_rate_bp / 100),
    cost_code_id: line.cost_code?.id ?? '',
  }));
}

/** The line priced as the API will price it, or null while it is still being typed. */
function tryPrice(line: LineDraft, digits: number, symbol: string) {
  const bp = percentToBp(line.tax);
  if (!/^\d+(?:\.\d{1,3})?$/.test(line.quantity.trim()) || Number.isNaN(bp) || !line.rate.trim()) {
    return null;
  }
  try {
    return priceLine({
      quantity: line.quantity.trim(),
      unit_rate: BigInt(amountToMinorString(line.rate, digits, symbol)),
      tax_rate_bp: bp,
    });
  } catch {
    return null;
  }
}
