import { describe, expect, it } from 'vitest';
import { byTrouble, schedule, statusLabel, statusTone, totalBudget } from './projects';
import type { ProjectSummary } from './api-types';

function site(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p1',
    name: 'Site',
    status: 'active',
    start_date: '2026-01-01',
    target_end_date: '2026-12-31',
    budget_amount: null,
    ...over,
  } as ProjectSummary;
}

describe('a site against its own planned window', () => {
  it('reports elapsed time, not progress', () => {
    // The distinction is the point: half the calendar gone is not half the building built, and a
    // card that conflated them would flatter every late site on the screen.
    const half = schedule(site({ start_date: '2026-01-01', target_end_date: '2026-12-31' }), '2026-07-01');
    expect(half?.elapsedPercent).toBeGreaterThan(45);
    expect(half?.elapsedPercent).toBeLessThan(55);
  });

  it('says nothing at all when there are no dates to say it about', () => {
    // A site entered the day it was won has a name and nothing else. Inventing a percentage from
    // that would be inventing the number, so the card shows no bar rather than a wrong one.
    expect(schedule(site({ start_date: null }))).toBeNull();
    expect(schedule(site({ target_end_date: null }))).toBeNull();
    expect(schedule(site({ start_date: '2026-06-01', target_end_date: '2026-01-01' }))).toBeNull();
  });

  it('counts days past target, and calls it blocked', () => {
    const late = schedule(site({ target_end_date: '2026-03-01' }), '2026-03-11');
    expect(late?.tone).toBe('blocked');
    expect(late?.daysRemaining).toBeLessThan(0);
    expect(late?.label).toBe('10 days past target');
  });

  it('gets the singular right on the day either side of the line', () => {
    // "1 days left" is the kind of thing a builder notices and a developer does not.
    expect(schedule(site({ target_end_date: '2026-03-02' }), '2026-03-01')?.label).toBe('1 day left');
    expect(schedule(site({ target_end_date: '2026-03-01' }), '2026-03-02')?.label).toBe(
      '1 day past target',
    );
  });

  it('warns in the last fortnight, not before', () => {
    expect(schedule(site({ target_end_date: '2026-03-15' }), '2026-03-01')?.tone).toBe('pending');
    expect(schedule(site({ target_end_date: '2026-04-30' }), '2026-03-01')?.tone).toBe('done');
  });

  it('treats a completed site as finished however its dates read', () => {
    const done = schedule(
      site({ status: 'completed', target_end_date: '2026-01-10' }),
      '2026-06-01',
    );
    expect(done?.elapsedPercent).toBe(100);
    expect(done?.tone).toBe('neutral');
    expect(done?.label).toBe('Completed');
  });
});

describe('the order sites are shown in', () => {
  it('puts trouble first, because that is the point of the screen', () => {
    const ordered = [
      site({ id: 'done', status: 'completed' }),
      site({ id: 'planning', status: 'planning' }),
      site({ id: 'held', status: 'on_hold' }),
      site({ id: 'running', status: 'active' }),
    ].sort(byTrouble);
    expect(ordered.map((p) => p.id)).toEqual(['held', 'running', 'planning', 'done']);
  });

  it('within a status, floats the most overdue to the top', () => {
    const ordered = [
      site({ id: 'fine', start_date: '2026-01-01', target_end_date: '2099-01-01' }),
      // Started long ago and overdue since — not an end date before its start, which `schedule`
      // rejects outright and which would rank this last rather than first.
      site({ id: 'late', start_date: '2019-01-01', target_end_date: '2020-01-01' }),
    ].sort(byTrouble);
    expect(ordered[0]!.id).toBe('late');
  });
});

describe('budgets', () => {
  it('adds them as bigint, so crores do not lose paise', () => {
    /*
     * These are paise. Four sites at ninety lakh each is 3.6e10 paise — still inside a double, but
     * the sum of a busy account is not, and the moment one of these goes through Number the last
     * digits stop being real money.
     */
    const total = totalBudget([
      site({ budget_amount: '9000000000' }),
      site({ budget_amount: '9000000000' }),
      site({ budget_amount: '9000000001' }),
      site({ budget_amount: null }),
    ]);
    expect(total).toBe(27000000001n);
    expect(typeof total).toBe('bigint');
  });

  it('survives a precision that a double would not', () => {
    const huge = '9007199254740993'; // 2^53 + 1: the first integer a double cannot hold
    expect(totalBudget([site({ budget_amount: huge })]).toString()).toBe(huge);
  });

  it('is zero for no sites', () => {
    expect(totalBudget([])).toBe(0n);
  });
});

describe('status wording', () => {
  it('uses the builder s word, not the database s', () => {
    expect(statusLabel('active')).toBe('On site');
    expect(statusLabel('on_hold')).toBe('On hold');
  });

  it('degrades readably for a status it has never heard of', () => {
    // Better a tidy "Awaiting sanction" than a crash or a raw enum, if one is ever added.
    expect(statusLabel('awaiting_sanction')).toBe('awaiting sanction');
    expect(statusTone('awaiting_sanction')).toBe('neutral');
  });
});
