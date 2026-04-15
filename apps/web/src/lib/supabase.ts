import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error(
      'Manca la configurazione Supabase: impostare VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (vedi .env.example).',
    );
  }
  browserClient = createClient(url, key);
  return browserClient;
}
