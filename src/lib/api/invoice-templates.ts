// Invoice templates saved per organisation (table invoice_templates, see
// supabase/migrations/20261110_invoice_templates.sql). Reads are open to every
// member; writes are for owners and admins (enforced by RLS).

import { supabase } from '@/lib/supabase';
import type { PaperConfig } from '@/components/InvoicePaper';
import { normalizeConfig } from '@/lib/invoice-template';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export interface SavedTemplate {
  id:        string;
  presetKey: string | null;
  name:      string;
  config:    PaperConfig;
  isDefault: boolean;
  starred:   boolean;
}

export interface TemplateDraft {
  presetKey?: string | null;
  name:       string;
  config:     PaperConfig;
  starred?:   boolean;
}

interface Row {
  id: string; preset_key: string | null; name: string; config: unknown; is_default: boolean; starred: boolean;
}
const COLUMNS = 'id, preset_key, name, config, is_default, starred';

const fromRow = (r: Row): SavedTemplate => ({
  id: r.id, presetKey: r.preset_key, name: r.name, config: normalizeConfig(r.config),
  isDefault: r.is_default, starred: r.starred,
});

// Demo mode keeps templates in this browser only
const mockKey = (orgId: string) => `billio.mock.templates.${orgId}`;
function mockRead(orgId: string): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(mockKey(orgId));
    const list = raw ? (JSON.parse(raw) as SavedTemplate[]) : [];
    return list.map(t => ({ ...t, config: normalizeConfig(t.config) }));
  } catch { return []; }
}
function mockWrite(orgId: string, list: SavedTemplate[]) {
  try { localStorage.setItem(mockKey(orgId), JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export async function fetchTemplates(orgId: string): Promise<SavedTemplate[]> {
  if (MOCK) return mockRead(orgId);
  const { data, error } = await supabase
    .from('invoice_templates')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

/** The organisation's default template, or null when it hasn't chosen one. */
export async function fetchDefaultTemplate(orgId: string): Promise<SavedTemplate | null> {
  if (MOCK) return mockRead(orgId).find(t => t.isDefault) ?? null;
  const { data, error } = await supabase
    .from('invoice_templates')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as Row) : null;
}

export async function createTemplate(orgId: string, draft: TemplateDraft): Promise<SavedTemplate> {
  const name = draft.name.trim() || 'Nouveau modèle';
  if (MOCK) {
    const list = mockRead(orgId);
    const t: SavedTemplate = {
      id: crypto.randomUUID(), presetKey: draft.presetKey ?? null, name,
      config: normalizeConfig(draft.config), isDefault: false, starred: draft.starred ?? false,
    };
    mockWrite(orgId, [...list, t]);
    return t;
  }
  const { data, error } = await supabase
    .from('invoice_templates')
    .insert({ org_id: orgId, preset_key: draft.presetKey ?? null, name, config: draft.config, starred: draft.starred ?? false })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as Row);
}

export async function updateTemplate(
  orgId: string, id: string, patch: Partial<Pick<SavedTemplate, 'name' | 'config' | 'starred'>>,
): Promise<SavedTemplate> {
  if (MOCK) {
    const list = mockRead(orgId);
    const i = list.findIndex(t => t.id === id);
    if (i < 0) throw new Error('Modèle introuvable');
    list[i] = { ...list[i], ...patch, config: normalizeConfig(patch.config ?? list[i].config) };
    mockWrite(orgId, list);
    return list[i];
  }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined)    row.name = patch.name.trim() || 'Nouveau modèle';
  if (patch.config !== undefined)  row.config = patch.config;
  if (patch.starred !== undefined) row.starred = patch.starred;
  // RLS filters rows the caller may not change without an error; .single()
  // turns "no row updated" into one instead of a silent no-op
  const { data, error } = await supabase
    .from('invoice_templates')
    .update(row)
    .eq('id', id)
    .eq('org_id', orgId)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as Row);
}

export async function setDefaultTemplate(orgId: string, id: string): Promise<void> {
  if (MOCK) {
    mockWrite(orgId, mockRead(orgId).map(t => ({ ...t, isDefault: t.id === id })));
    return;
  }
  const { error } = await supabase.rpc('set_default_invoice_template', { p_template_id: id });
  if (error) throw error;
}
