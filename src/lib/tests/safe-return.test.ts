import { describe, expect, it } from 'vitest';
import { safeReturn } from '@/lib/safe-return';

const O = 'https://billio.example';

describe('safeReturn', () => {
  it('keeps same-app paths with their query and hash', () => {
    expect(safeReturn('/invoices/INV-0042', O)).toBe('/invoices/INV-0042');
    expect(safeReturn('/invoices?tab=quotes#top', O)).toBe('/invoices?tab=quotes#top');
  });

  it.each([
    null, '', 'invoices', 'https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil.example',
    '/\\/evil.example', '/\tevil', '/\nevil', 'javascript:alert(1)',
  ])('falls back for %j', path => {
    expect(safeReturn(path, O)).toBe('/dashboard');
  });

  it('uses the given fallback', () => {
    expect(safeReturn('//evil.example', O, '/invoices')).toBe('/invoices');
  });
});
