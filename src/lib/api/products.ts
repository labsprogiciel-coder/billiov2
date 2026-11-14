import { supabase } from '@/lib/supabase';
import { INITIAL_PRODUCTS, MOCK_TEAM } from '@/data';

const mockChange = () => ({ updatedAt: new Date().toISOString(), updatedByName: MOCK_TEAM[0].name });
import type { Product } from '@/lib/schemas';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export function dbToProduct(row: Record<string, unknown>): Product {
  return {
    id:    String(row.id),
    name:  String(row.name),
    sku:   String(row.sku ?? '—'),
    type:  (row.type ?? 'service') as Product['type'],
    unit:  String(row.unit),
    price: Number(row.price),
    tax:   Number(row.tax ?? 0),
    used:  Number(row.used ?? 0),
    ico:   String(row.ico ?? 'package'),
    color: String(row.color ?? 'ico-blue'),
    updatedAt:     row.updated_at ? String(row.updated_at) : undefined,
    updatedByName: row.updated_by_name ? String(row.updated_by_name) : undefined,
    createdById:   row.created_by ? String(row.created_by) : undefined,
  };
}

export async function fetchProducts(orgId: string): Promise<Product[]> {
  if (MOCK) return [...INITIAL_PRODUCTS];
  const { data, error } = await supabase
    .from('products')
    .select('*, line_items(count)')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => {
    const r = row as Record<string, unknown>;
    const countArr = r.line_items as Array<{ count: number }> | undefined;
    const used = countArr?.[0]?.count ?? 0;
    return dbToProduct({ ...r, used });
  });
}

export async function createProduct(
  orgId: string,
  payload: Omit<Product, 'used'>,
): Promise<Product> {
  if (MOCK) return { ...payload, used: 0, ...mockChange(), createdById: MOCK_TEAM[0].id };
  const { data, error } = await supabase
    .from('products')
    .insert({
      id:      payload.id,
      org_id:  orgId,
      name:    payload.name,
      sku:     payload.sku,
      type:    payload.type,
      unit:    payload.unit,
      price:   payload.price,
      tax:     payload.tax,
      used:    0,
      ico:     payload.ico,
      color:   payload.color,
    })
    .select()
    .single();
  if (error) throw error;
  return dbToProduct(data as Record<string, unknown>);
}

/** Returns when and by whom the item was last changed, as the database stored it (PRO-173). */
export async function updateProduct(id: string, patch: Partial<Product>): Promise<Pick<Product, 'updatedAt' | 'updatedByName'>> {
  if (MOCK) return mockChange();
  const { data, error } = await supabase.from('products').update(patch).eq('id', id).select('updated_at, updated_by_name').single();
  if (error) throw error;
  const row = data as Record<string, unknown>;
  return {
    updatedAt:     row.updated_at ? String(row.updated_at) : undefined,
    updatedByName: row.updated_by_name ? String(row.updated_by_name) : undefined,
  };
}

export async function removeProduct(id: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}
