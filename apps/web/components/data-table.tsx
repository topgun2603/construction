'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Placeholder for the search box; omit the box entirely by leaving this out. */
  searchPlaceholder?: string;
  /** Rows per page. Omit to show every row without pagination. */
  pageSize?: number;
  emptyMessage?: string;
  onRowClick?: (row: TData) => void;
  /** Extra controls rendered beside the search box. */
  toolbar?: React.ReactNode;
}

/**
 * The shared table. Sorting, filtering and pagination run client-side on an
 * already-fetched page: these lists are a site's workers or a week's payments —
 * hundreds of rows, not millions — so shipping the page and sorting in the browser
 * is faster than a round trip per column click. The API's cursor pagination is
 * what bounds the fetch.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder,
  pageSize,
  emptyMessage = 'Nothing here yet.',
  onRowClick,
  toolbar,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pageSize
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize } },
        }
      : {}),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      {(searchPlaceholder || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder && (
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
              <Input
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {toolbar}
        </div>
      )}

      <div className="overflow-hidden rounded-panel border border-line bg-surface">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      style={header.column.columnDef.meta ? undefined : undefined}
                      className={cn(
                        (header.column.columnDef.meta as { align?: string } | undefined)?.align ===
                          'right' && 'text-right',
                      )}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex min-h-0 items-center gap-1 uppercase tracking-[0.06em] transition hover:text-ink"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-10 text-center text-ink-muted">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                <motion.tr
                  key={row.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  // Capped so a 200-row table does not take four seconds to appear.
                  transition={{ duration: 0.18, delay: Math.min(index, 12) * 0.015 }}
                  onClick={
                    onRowClick
                      ? (event) => {
                          /*
                           * A click on a control inside the row is about that control, not the row.
                           *
                           * Without this, the delete button on the sites table opened the site
                           * instead of asking to delete it — the click bubbled to the row and
                           * navigated. Radix portals its dialog content but React still propagates
                           * through the component tree, so pressing Delete *inside* the confirmation
                           * navigated too.
                           *
                           * Checked here rather than by calling stopPropagation on every control,
                           * because that only works for the controls somebody remembered.
                           */
                          const target = event.target as HTMLElement;
                          if (
                            target.closest(
                              'button, a, input, select, textarea, label, [role="menuitem"], [role="dialog"], [data-no-row-click]',
                            )
                          ) {
                            return;
                          }
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-line-soft transition last:border-0 hover:bg-raised',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        (cell.column.columnDef.meta as { align?: string } | undefined)?.align ===
                          'right' && 'text-right',
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </motion.tr>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pageSize && table.getPageCount() > 1 && (
        <div className="flex items-center justify-between gap-3 text-[13px] text-ink-muted">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} ·{' '}
            {rows.length} of {data.length} rows
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
