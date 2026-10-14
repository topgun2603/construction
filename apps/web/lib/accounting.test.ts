import { describe, expect, it } from 'vitest';
import { changedAccountingRows, fileSize } from './accounting';

describe('changedAccountingRows', () => {
  const saved = {
    bank: { code: '1020', name: 'Bank' },
    cash: { code: '1000', name: 'Cash' },
    'expense:fuel': null,
  };

  it('sends only what changed', () => {
    expect(
      changedAccountingRows(saved, {
        bank: { code: '1020', name: 'Bank ' },
        cash: { code: '1001', name: 'Cash in hand' },
        'expense:fuel': { code: '', name: 'Fuel Expenses' },
      }),
    ).toEqual([
      { key: 'cash', code: '1001', name: 'Cash in hand' },
      { key: 'expense:fuel', code: '', name: 'Fuel Expenses' },
    ]);
  });

  it('clears a saved row with an empty name, and ignores clearing one never saved', () => {
    expect(
      changedAccountingRows(saved, {
        bank: { code: '1020', name: '' },
        'expense:fuel': { code: '', name: '  ' },
      }),
    ).toEqual([{ key: 'bank', code: '', name: '' }]);
  });
});

describe('fileSize', () => {
  it('reads like a file list', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2048)).toBe('2.0 KB');
    expect(fileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
