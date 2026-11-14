import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DataTable, { SummaryStrip } from '@/components/DataTable';
import { applyTableQuery, filterCounts, normalizeSearch, paginate, pagerItems, type TableQuery } from '@/lib/data-table';

interface Row { id: string; client: string; status: 'paid' | 'late' | 'draft'; owner: string }
const rows: Row[] = [
  { id: 'FACT-2026-0031', client: 'Kossi BTP', status: 'late', owner: 'AK' },
  { id: 'FACT-2026-0034', client: 'Sahel Distribution', status: 'paid', owner: 'FS' },
  { id: 'FACT-2026-0035', client: 'Wend-Panga Hôtel', status: 'late', owner: 'IT' },
  { id: 'BR-1', client: 'Faso Tech Services', status: 'draft', owner: 'FS' },
];
const filters = [
  { key: 'late', label: 'En retard', match: (r: Row) => r.status === 'late' },
  { key: 'paid', label: 'Payées', match: (r: Row) => r.status === 'paid' },
];
const q = (over: Partial<TableQuery<Row>> = {}): TableQuery<Row> => ({
  filter: 'all', filters, query: '', searchText: r => `${r.id} ${r.client}`, mineOnly: false, isMine: r => r.owner === 'FS', ...over,
});

describe('applyTableQuery', () => {
  it('filters by status, search and « Mes … »', () => {
    expect(applyTableQuery(rows, q()).length).toBe(4);
    expect(applyTableQuery(rows, q({ filter: 'late' })).map(r => r.id)).toEqual(['FACT-2026-0031', 'FACT-2026-0035']);
    expect(applyTableQuery(rows, q({ query: 'hotel' })).map(r => r.id)).toEqual(['FACT-2026-0035']);
    expect(applyTableQuery(rows, q({ query: 'fact 0034' })).map(r => r.id)).toEqual(['FACT-2026-0034']);
    expect(applyTableQuery(rows, q({ mineOnly: true })).map(r => r.id)).toEqual(['FACT-2026-0034', 'BR-1']);
    expect(applyTableQuery(rows, q({ filter: 'nope' })).length).toBe(4);
  });

  it('counts each filter within the current switch and search', () => {
    expect(filterCounts(rows, q())).toEqual({ all: 4, late: 2, paid: 1 });
    expect(filterCounts(rows, q({ mineOnly: true }))).toEqual({ all: 2, late: 0, paid: 1 });
  });

  it('ignores accents, case and extra spaces', () => {
    expect(normalizeSearch('  Échéance   Hôtel ')).toBe('echeance hotel');
  });
});

describe('paginate', () => {
  const many = Array.from({ length: 53 }, (_, i) => i);
  it('slices and clamps', () => {
    expect(paginate(many, 1, 25)).toMatchObject({ page: 1, pageCount: 3, from: 1, to: 25, total: 53 });
    expect(paginate(many, 3, 25)).toMatchObject({ page: 3, from: 51, to: 53 });
    expect(paginate(many, 9, 25).page).toBe(3);
    expect(paginate([], 1, 25)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0 });
  });
  it('shows first, last and neighbours with gaps', () => {
    expect(pagerItems(1, 3)).toEqual([1, 2, 3]);
    expect(pagerItems(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pagerItems(1, 1)).toEqual([1]);
  });
});

describe('<DataTable>', () => {
  const html = renderToStaticMarkup(createElement(DataTable<Row>, {
    caption: 'Factures', rows, rowKey: r => r.id, rowLabel: r => r.id, noun: { one: 'facture', many: 'factures' },
    columns: [
      { key: 'id', header: 'N°', cell: r => r.id },
      { key: 'client', header: 'Client', cell: r => r.client },
      { key: 'owner', header: 'Responsable', cell: r => r.owner, hidden: true },
    ],
    filters, search: { placeholder: 'N°, client ou objet…', text: r => `${r.id} ${r.client}` },
    mine: { label: 'Mes factures', isMine: r => r.owner === 'FS' },
    selectable: true, onRowClick: () => {}, rowActions: () => [{ label: 'Télécharger le PDF', onSelect: () => {} }],
  }));

  it('is a real table with a caption, filter counts and labelled controls', () => {
    expect(html).toContain('<caption');
    expect(html).toContain('>Factures</caption>');
    expect(html).toMatch(/En retard <span class="dt-chip-ct">2<\/span>/);
    expect(html).toContain('aria-label="Sélectionner FACT-2026-0031"');
    expect(html).toContain('aria-label="Actions pour FACT-2026-0031"');
    expect(html).toContain('aria-label="Ouvrir FACT-2026-0031"');
    expect(html).toContain('4 factures');
  });

  it('leaves out hidden columns', () => {
    expect(html).not.toContain('Responsable');
  });

  it('renders the summary strip as a description list', () => {
    const strip = renderToStaticMarkup(createElement(SummaryStrip, { items: [{ label: 'En retard', value: '1 648 800', unit: 'FCFA', note: '3 factures', tone: 'late' }] }));
    expect(strip).toContain('<dt>En retard</dt>');
    expect(strip).toContain('dt-strip-note late');
  });
});
