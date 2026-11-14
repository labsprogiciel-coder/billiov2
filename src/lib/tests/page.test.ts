import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { documentTitleFor, shouldMoveFocus } from '@/lib/page';

describe('documentTitleFor', () => {
  it('names the tab after the page', () => {
    expect(documentTitleFor('Devis')).toBe('Devis · Billio');
    expect(documentTitleFor('  Facture FACT-2026-0031 ')).toBe('Facture FACT-2026-0031 · Billio');
    expect(documentTitleFor('')).toBe('Billio');
  });
});

describe('shouldMoveFocus', () => {
  it('moves focus to the heading unless the user is typing', () => {
    expect(shouldMoveFocus(null)).toBe(true);
    expect(shouldMoveFocus({ tagName: 'BODY' })).toBe(true);
    expect(shouldMoveFocus({ tagName: 'A' })).toBe(true);
    expect(shouldMoveFocus({ tagName: 'INPUT' })).toBe(false);
    expect(shouldMoveFocus({ tagName: 'textarea' })).toBe(false);
    expect(shouldMoveFocus({ tagName: 'SELECT' })).toBe(false);
    expect(shouldMoveFocus({ tagName: 'DIV', isContentEditable: true })).toBe(false);
  });
});

// Every app page draws its header through <Page>, so the ERP top bar
// (PRO-161) changes one component. The template editor keeps its own header
// (an editable template name), the only exception.
describe('pages use <Page>', () => {
  const root = resolve(__dirname, '../../pages');
  const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
  const ALLOWED: Record<string, number> = { 'TemplatesPage.tsx': 1 };

  it('no page builds its own topbar', () => {
    const offenders = files(root).flatMap(p => {
      const n = (readFileSync(p, 'utf8').match(/className="topbar"/g) ?? []).length;
      const name = p.slice(root.length + 1);
      return n > (ALLOWED[name] ?? 0) ? [`${name}: ${n}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
