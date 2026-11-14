// The organisation's members, for choosing a « Responsable » (PRO-172).
// Loaded once per organisation and shared by every component that asks.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { MOCK_TEAM } from '@/data';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export interface TeamMember { id: string; name: string; role: string }

interface TeamRow { user_id: string; role: string; email: string; first_name: string | null; last_name: string | null }

/** Same rule as the database's member_display_name(): profile name, else the e-mail's local part. */
export function memberDisplayName(m: Pick<TeamRow, 'email' | 'first_name' | 'last_name'>): string {
  const full = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim();
  return full || (m.email ?? '').split('@')[0];
}

const cache = new Map<string, Promise<TeamMember[]>>();

function loadTeam(orgId: string): Promise<TeamMember[]> {
  if (MOCK) return Promise.resolve(MOCK_TEAM);
  let p = cache.get(orgId);
  if (!p) {
    p = Promise.resolve(supabase.rpc('get_org_team', { p_org_id: orgId })).then(({ data, error }) => {
      if (error) { cache.delete(orgId); throw error; }
      return ((data as TeamRow[]) ?? [])
        .map(r => ({ id: r.user_id, name: memberDisplayName(r), role: r.role }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    });
    cache.set(orgId, p);
  }
  return p;
}

/** The team, sorted by name; empty until loaded (or if it can't be read). */
export function useTeam(enabled = true): TeamMember[] {
  const { orgId } = useApp();
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (!enabled || (!orgId && !MOCK)) return;
    let live = true;
    loadTeam(orgId).then(t => { if (live) setTeam(t); }).catch(err => console.warn('[useTeam]', err));
    return () => { live = false; };
  }, [orgId, enabled]);
  return team;
}
