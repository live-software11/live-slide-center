import type { Database } from '@slidecenter/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient<Database> | null = null;

export function isSupabaseBrowserConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url?.trim() && key?.trim());
}

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error(
      'Manca la configurazione Supabase: impostare VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (vedi .env.example).',
    );
  }
  browserClient = createClient<Database>(url, key);
  return browserClient;
}
