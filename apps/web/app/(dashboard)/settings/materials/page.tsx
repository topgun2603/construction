import { serverFetch } from '@/lib/server-api';
import { Package } from 'lucide-react';
import type { Material, Page } from '@/lib/api-types';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { DeleteRowButton } from '@/components/delete-row-button';
import { deleteMaterial } from '@/lib/actions';
import { AddMaterialDialog } from './add-material-dialog';

export const metadata = { title: 'Materials · BUILDR' };

export default async function MaterialsPage() {
  const materials = await serverFetch<Page<Material>>('/materials?limit=500');

  const byCategory = new Map<string, Material[]>();
  for (const material of materials.items) {
    const key = material.category ?? 'Uncategorised';
    byCategory.set(key, [...(byCategory.get(key) ?? []), material]);
  }

  return (
    <FadeIn className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
          The catalogue supervisors pick from when raising an indent. Adding a name that already
          exists reuses it rather than creating a duplicate.
        </p>
        <AddMaterialDialog />
      </div>

      {materials.items.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="No materials yet"
          body="Add cement, steel and aggregate so site staff can raise indents against them."
          action={<AddMaterialDialog />}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[...byCategory.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([category, items]) => (
              <Card key={category} className="flex flex-col">
                <div className="border-b border-line-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {category}
                </div>
                <ul className="divide-y divide-line-soft">
                  {items.map((material) => (
                    <li
                      key={material.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]"
                    >
                      <span className="truncate">{material.name}</span>
                      <span className="flex flex-none items-center gap-2">
                        <span className="font-mono text-[12.5px] text-ink-muted">
                          {material.unit}
                        </span>
                        <DeleteRowButton
                          what={material.name}
                          body={
                            <>
                              <strong className="font-semibold text-ink">{material.name}</strong>{' '}
                              comes out of the catalogue. Indents that already list it keep their
                              record.
                            </>
                          }
                          successMessage={`${material.name} deleted`}
                          onConfirm={deleteMaterial.bind(null, material.id)}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
        </div>
      )}
    </FadeIn>
  );
}
