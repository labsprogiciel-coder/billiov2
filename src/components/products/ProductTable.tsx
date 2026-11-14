// The catalogue of the ERP look (PRO-170): summary strip and the shared dense
// table. ProductsPage renders it instead of its cards, list and grid when
// VITE_UI_V2 is on; the item form stays in the page.

import { useMemo } from 'react';
import DataTable, { SummaryStrip, type Column, type RowAction, type StatusFilter } from '@/components/DataTable';
import { useApp } from '@/context/AppContext';
import { catalogueFigures } from '@/lib/catalogue';
import { lastChangeLabel } from '@/lib/change-label';
import { fmt, fmtCompact, fmtDate } from '@/data';
import type { Product } from '@/lib/schemas';

export default function ProductTable({ writable, deletable, onEdit, onDelete }: {
  writable: boolean;
  deletable: boolean;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}) {
  const { products, userId } = useApp();
  const figures = useMemo(() => catalogueFigures(products), [products]);

  const filters = useMemo<StatusFilter<Product>[]>(() => [
    { key: 'service', label: 'Services', match: p => p.type === 'service' },
    { key: 'product', label: 'Produits', match: p => p.type === 'product' },
    { key: 'mine', label: 'Créés par moi', match: p => !!userId && p.createdById === userId },
    { key: 'noprice', label: 'Sans prix', match: p => !(p.price > 0) },
  ], [userId]);
  const search = useMemo(() => ({ placeholder: 'Code ou nom…', text: (p: Product) => `${p.sku} ${p.name}` }), []);

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'Code', width: '110px', cell: p => p.sku !== '—' ? <span className="dt-ref">{p.sku}</span> : <span className="dt-muted">—</span> },
    { key: 'name', header: 'Article', cell: p => <span className="dt-clip">{p.name}</span> },
    { key: 'type', header: 'Type', cell: p => p.type === 'service' ? 'Service' : 'Produit' },
    { key: 'unit', header: 'Unité', cell: p => p.unit },
    {
      key: 'price', header: 'Prix HT', align: 'right',
      cell: p => p.price > 0 ? fmt(p.price) : <span className="dt-status partial" title="Une ligne avec cet article vaudra 0">Sans prix</span>,
    },
    { key: 'tax', header: 'TVA', align: 'right', width: '64px', cell: p => `${p.tax} %` },
    { key: 'used', header: 'Facturé', align: 'right', width: '80px', cell: p => p.used ? `${p.used}×` : <span className="dt-muted">—</span> },
    {
      key: 'changed', header: 'Dernière modification',
      cell: p => {
        const label = lastChangeLabel(p, fmtDate);
        return label ? <span className="dt-sub">{label.replace(/^Modifié le /, '')}</span> : <span className="dt-muted">—</span>;
      },
    },
  ];

  const rowActions = (): RowAction<Product>[] => [
    ...(writable ? [{ label: 'Modifier', icon: 'edit', onSelect: onEdit }] : []),
    ...(deletable ? [{ label: 'Supprimer', icon: 'trash', danger: true, onSelect: onDelete }] : []),
  ];

  return (
    <>
      <SummaryStrip items={[
        { label: 'Articles au catalogue', value: figures.count, note: `${products.filter(p => p.type === 'service').length} services · ${products.filter(p => p.type === 'product').length} produits` },
        { label: 'Le plus facturé', value: figures.top ? <span className="dt-strip-text">{figures.top.name}</span> : '—', note: figures.top ? `${figures.top.used} lignes` : 'pas encore facturé' },
        { label: 'Revenu catalogue', value: fmtCompact(figures.revenue), unit: 'F CFA', note: 'prix actuel × utilisations' },
        {
          label: 'Sans prix', value: figures.noPrice,
          note: figures.noPrice ? 'donneraient des lignes à 0' : 'tous les articles ont un prix',
          tone: figures.noPrice ? 'late' : 'good',
        },
      ]} />
      <DataTable
        caption="Catalogue"
        rows={products}
        rowKey={p => p.id}
        rowLabel={p => p.name}
        noun={{ one: 'article', many: 'articles' }}
        allLabel="Tous"
        columns={columns}
        filters={filters}
        search={search}
        onRowClick={writable ? onEdit : undefined}
        rowActions={writable || deletable ? rowActions : undefined}
        emptyMessage={products.length === 0 ? 'Aucun article pour le moment. Ajoutez votre premier article.' : 'Aucun article ne correspond.'}
      />
    </>
  );
}
