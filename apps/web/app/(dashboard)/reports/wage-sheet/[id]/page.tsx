import { notFound } from 'next/navigation';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { WageSheet } from '@/lib/api-types';
import { money, longDate } from '@/lib/format';
import { PrintButton } from './print-button';

export const metadata = { title: 'Wage sheet · BUILDR' };

/**
 * The sheet a builder prints and carries to site (spec §8A).
 *
 * Deliberately plain: black on white, a signature column, and `print:` rules that
 * drop the app chrome — this page exists to become paper.
 */
export default async function WageSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let sheet: WageSheet;
  try {
    sheet = await serverFetch<WageSheet>(`/reports/wage-sheet/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-[21px] font-semibold">Wage sheet</h2>
          <p className="text-[13.5px] text-ink-muted">
            {sheet.contractor.name} · {longDate(sheet.period_start)} to {longDate(sheet.period_end)}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="rounded-panel border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-[18px] font-semibold">{sheet.builder}</div>
            <div className="text-[13.5px] text-ink-muted">
              Wage sheet · {sheet.contractor.name}
              {sheet.contractor.phone && ` · +${sheet.contractor.phone}`}
            </div>
          </div>
          <div className="text-right font-mono text-[13px]">
            <div>{longDate(sheet.period_start)}</div>
            <div>to {longDate(sheet.period_end)}</div>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                <Th className="w-10">#</Th>
                <Th>Worker</Th>
                <Th className="text-right">Days</Th>
                <Th className="text-right">OT hrs</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Advance</Th>
                <Th className="text-right">Net</Th>
                <Th className="w-40">Signature</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr key={row.worker_id} className="border-b border-line-soft">
                  <Td className="font-mono text-ink-muted">{row.serial}</Td>
                  <Td>
                    <div className="font-medium">{row.name}</div>
                    {row.trade && <div className="text-[11.5px] text-ink-muted">{row.trade}</div>}
                  </Td>
                  <Td className="text-right font-mono">{row.days}</Td>
                  <Td className="text-right font-mono">{row.overtime_hours}</Td>
                  <Td className="text-right font-mono">{money(row.gross)}</Td>
                  <Td className="text-right font-mono">
                    {BigInt(row.advances) > 0n ? `− ${money(row.advances)}` : '—'}
                  </Td>
                  <Td className="text-right font-mono font-semibold">{money(row.net)}</Td>
                  {/* Signed in ink at the site — the column is intentionally blank. */}
                  <Td className="border-l border-line-soft" />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <Td colSpan={4} className="text-right">
                  Total
                </Td>
                <Td className="text-right font-mono">{money(sheet.totals.gross)}</Td>
                <Td className="text-right font-mono">− {money(sheet.totals.advances)}</Td>
                <Td className="text-right font-mono">{money(sheet.totals.net)}</Td>
                <Td />
              </tr>
            </tfoot>
          </table>
        </div>

        <footer className="mt-8 flex justify-between gap-8 text-[12.5px] text-ink-muted">
          <div className="border-t border-line pt-2">Prepared by</div>
          <div className="border-t border-line pt-2">Contractor signature</div>
          <div className="border-t border-line pt-2">Approved by</div>
        </footer>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-2 py-2.5 align-top ${className}`}>
      {children}
    </td>
  );
}
