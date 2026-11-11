import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis dans .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** The public anon key (already in the bundle); sent to the Worker so it can check a session. */
export const SUPABASE_ANON_KEY = supabaseAnonKey;
