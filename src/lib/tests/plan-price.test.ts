import { describe, expect, it } from 'vitest';
import { PLANS, planPrice } from '@/lib/plans';

const plan = (id: string) => PLANS.find(p => p.id === id)!;

describe('planPrice', () => {
  it('shows monthly prices in the monthly view', () => {
    expect(planPrice(plan('business'), 'monthly')).toEqual({ amount: 25_000, per: '/ mois' });
    expect(planPrice(plan('solo'), 'monthly')).toEqual({ amount: 0, per: '/ mois' });
  });
  it('shows yearly prices in the yearly view', () => {
    expect(planPrice(plan('business'), 'annual')).toEqual({ amount: 300_000, per: '/ an' });
    expect(planPrice(plan('cabinet'), 'annual')).toEqual({ amount: 540_000, per: '/ an' });
    expect(planPrice(plan('solo'), 'annual')).toEqual({ amount: 0, per: '/ an' });
  });
  it('keeps the monthly price when a plan has no yearly one, and quotes stay on quote', () => {
    expect(planPrice({ price: 10_000 }, 'annual')).toEqual({ amount: 10_000, per: '/ mois' });
    expect(planPrice(plan('enterprise'), 'monthly').amount).toBeNull();
  });
});
