import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExportMenu, exportHref } from './export-menu';

/**
 * The export link carries the screen's filters — and only the ones that are set — so the file is
 * what the person was looking at. A table that already had a CSV keeps that link.
 */
describe('the export menu', () => {
  it('builds the export link from the filters that are set', () => {
    expect(exportHref('workers')).toBe('/excel/export/workers');
    expect(exportHref('expenses', { project_id: 'p1', status: '', from: undefined, to: null })).toBe(
      '/excel/export/expenses?project_id=p1',
    );
    expect(exportHref('audit', { entity: 'workers' }, 'csv')).toBe('/excel/export/audit?entity=workers&format=csv');
  });

  it('offers Excel and CSV, keeping a table’s own CSV link', async () => {
    render(<ExportMenu kind="purchase_orders" filters={{ status: 'approved' }} csvHref="/procurement/export?status=approved" />);
    fireEvent.keyDown(screen.getByText('Export'), { key: 'Enter' });
    const excel = (await screen.findByText('Excel (.xlsx)')).closest('a');
    expect(excel).toHaveAttribute('href', '/excel/export/purchase_orders?status=approved');
    expect(screen.getByText('CSV').closest('a')).toHaveAttribute('href', '/procurement/export?status=approved');
  });

  it('falls back to the shared CSV where a table had none', async () => {
    render(<ExportMenu kind="workers" />);
    fireEvent.keyDown(screen.getByText('Export'), { key: 'Enter' });
    expect((await screen.findByText('CSV')).closest('a')).toHaveAttribute('href', '/excel/export/workers?format=csv');
  });
});
