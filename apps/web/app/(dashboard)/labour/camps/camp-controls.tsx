'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CampResident, Worker } from '@/lib/api-types';
import { addCampResidents, campResidents, createCamp, removeCampResident } from '@/lib/actions';
import { useLanguage } from '@/components/language-provider';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

export function AddCampDialog() {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    const text = (name: string) => {
      const value = String(formData.get(name) ?? '').trim();
      return value === '' ? undefined : value;
    };
    const capacity = text('capacity');
    start(async () => {
      const result = await createCamp({
        name: String(formData.get('name') ?? ''),
        address: text('address'),
        capacity: capacity ? Number(capacity) : undefined,
        transport_note: text('transport_note'),
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not save'));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> {t('Add camp')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Add a camp')}</DialogTitle>
          <DialogDescription>
            {t('Where a crew lives, and the bus that takes them to site.')}
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <Field label={t('Name')} htmlFor="name">
            <Input id="name" name="name" required placeholder="Al Quoz Camp 2" />
          </Field>
          <Field label={t('Address')} htmlFor="address" optional>
            <Input id="address" name="address" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Beds')} htmlFor="capacity" optional>
              <Input id="capacity" name="capacity" type="number" min={1} inputMode="numeric" />
            </Field>
            <Field label={t('Bus or route')} htmlFor="transport_note" optional>
              <Input id="transport_note" name="transport_note" placeholder="Bus 3" />
            </Field>
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t('Saving…') : t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Who lives in a camp, with a way to move workers in and out. */
export function CampResidentsButton({
  campId,
  campName,
  workers,
  canManage,
}: {
  campId: string;
  campName: string;
  workers: Worker[];
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [residents, setResidents] = useState<CampResident[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const result = await campResidents(campId);
      setResidents(result.ok && result.data ? result.data : []);
    });
  }

  function add() {
    start(async () => {
      const result = await addCampResidents(campId, chosen);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not move them'));
        return;
      }
      setChosen([]);
      load();
      router.refresh();
    });
  }

  function remove(workerId: string) {
    start(async () => {
      const result = await removeCampResident(campId, workerId);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not move them'));
        return;
      }
      load();
      router.refresh();
    });
  }

  const living = new Set((residents ?? []).map((resident) => resident.id));
  const candidates = workers.filter(
    (worker) => worker.status === 'active' && !living.has(worker.id),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Users className="size-3.5" /> {t('Residents')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{campName}</DialogTitle>
          <DialogDescription>
            {t('Who lives here. Moving a worker in takes them out of any other camp.')}
          </DialogDescription>
        </DialogHeader>

        {residents === null ? (
          <p className="text-[13px] text-ink-muted">{t('Loading…')}</p>
        ) : residents.length === 0 ? (
          <p className="text-[13px] text-ink-muted">{t('Nobody lives here yet.')}</p>
        ) : (
          <ul className="flex max-h-56 flex-col divide-y divide-line-soft overflow-y-auto">
            {residents.map((resident) => (
              <li
                key={resident.id}
                className="flex items-center justify-between py-1.5 text-[13.5px]"
              >
                <span>
                  {resident.name}
                  {resident.trade && <span className="text-ink-muted"> · {resident.trade}</span>}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('Remove')}
                    disabled={pending}
                    onClick={() => remove(resident.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && candidates.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Move in')}
            </span>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {candidates.map((worker) => (
                <label key={worker.id} className="flex items-center gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={chosen.includes(worker.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, worker.id]
                          : current.filter((id) => id !== worker.id),
                      )
                    }
                  />
                  {worker.name}
                  {worker.trade && <span className="text-ink-muted"> · {worker.trade}</span>}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={add} disabled={pending || chosen.length === 0}>
                {t('Move in')} {chosen.length > 0 ? `(${chosen.length})` : ''}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
