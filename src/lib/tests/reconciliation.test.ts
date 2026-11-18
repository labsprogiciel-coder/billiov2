import { describe, expect, it } from 'vitest';
import { reconcileStatus } from '@/lib/sales-tables';

describe('rapprochement (PRO-175)', () => {
  it('only a completed payment is matched or not', () => {
    expect(reconcileStatus({ status: 'completed' })).toBe('to_match');
    expect(reconcileStatus({ status: 'completed', reconciledAt: '2026-11-17T10:00:00Z' })).toBe('matched');
    expect(reconcileStatus({ status: 'pending' })).toBe('none');
    expect(reconcileStatus({ status: 'failed', reconciledAt: '2026-11-17T10:00:00Z' })).toBe('none');
  });
});
