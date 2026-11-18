import { supabase } from '@/lib/supabase';
import type { LineItem } from '@/lib/schemas';
import { isTaxGroup } from '@/lib/tax-groups';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

function dbToLineItem(row: Record<string, unknown>): LineItem {
  return {
    id:    String(row.id),
    desc:  String(row.description),
    unit:  String(row.unit ?? 'unité'),
    qty:   Number(row.qty),
    price: Number(row.price),
    ...(row.product_id ? { productId: String(row.product_id) } : {}),
    ...(isTaxGroup(row.tax_group) ? { taxGroup: row.tax_group } : {}),
  };
}

export async function fetchLineItems(
  orgId: string,
  opts: { invoiceId?: string; quoteId?: string },
): Promise<LineItem[]> {
  if (MOCK) return [];
  let query = supabase.from('line_items').select('*').eq('org_id', orgId);
  if (opts.invoiceId) query = query.eq('invoice_id', opts.invoiceId);
  else if (opts.quoteId) query = query.eq('quote_id', opts.quoteId);
  else return [];
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(r => dbToLineItem(r as Record<string, unknown>));
}

export async function saveLineItems(
  orgId: string,
  lines: LineItem[],
  opts: { invoiceId?: string; quoteId?: string },
): Promise<void> {
  if (MOCK || lines.length === 0) return;
  const rows = lines.map(l => ({
    org_id:      orgId,
    invoice_id:  opts.invoiceId  ?? null,
    quote_id:    opts.quoteId    ?? null,
    product_id:  l.productId     ?? null,
    description: l.desc,
    unit:        l.unit ?? 'unité',
    qty:         l.qty,
    price:       l.price,
    tax_group:   l.taxGroup      ?? null,
  }));
  const { error } = await supabase.from('line_items').insert(rows);
  if (error) throw error;
}

export async function deleteLineItems(orgId: string, opts: { invoiceId?: string; quoteId?: string }): Promise<void> {
  if (MOCK) return;
  if (opts.invoiceId) {
    const { error } = await supabase.from('line_items').delete().eq('org_id', orgId).eq('invoice_id', opts.invoiceId);
    if (error) throw error;
  } else if (opts.quoteId) {
    const { error } = await supabase.from('line_items').delete().eq('org_id', orgId).eq('quote_id', opts.quoteId);
    if (error) throw error;
  }
}
