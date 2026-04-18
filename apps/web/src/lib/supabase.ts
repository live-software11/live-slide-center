import type { Database } from '@slidecenter/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getBackendMode } from './backend-mode';
import { getCachedDesktopBackendInfo } from './desktop-backend-init';

let browserClient: SupabaseClient<Database> | null = null;

export function isSupabaseBrowserConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url?.trim() && key?.trim());
}

/**
 * Sprint J5 → riscritto in Sprint O2 (GUIDA_OPERATIVA_v3 §4.G).
 *
 * Ritorna il client Supabase JS configurato per la modalita corrente:
 *   • cloud (default): URL/key da env Vercel/Supabase, sessione persistita,
 *     auto-refresh JWT (comportamento storico).
 *   • desktop (Tauri): URL = backend Rust locale (`http://127.0.0.1:7300`),
 *     key = `admin_token` UUID v4 generato al primo boot. Nessuna sessione
 *     persistita (single-user single-tenant locale, l'auth Supabase non
 *     esiste lato Rust). Il backend Rust mirror PostgREST: tutte le query
 *     `.from('table').select()` / `.rpc(...)` continuano a funzionare
 *     identiche grazie al modulo `pgrest.rs` Sprint K3.
 *
 * **Pre-condizione desktop**: chiamare `ensureDesktopBackendReady()` in
 * `main.tsx` PRIMA di renderizzare l'app, cosi' il cache e' popolato quando
 * questa funzione viene invocata.
 *
 * Realtime channels: in desktop il backend Rust NON espone WebSocket
 * Supabase-compatible. I `.channel().subscribe()` falliranno con
 * `CHANNEL_ERROR`, gli hook gia' degradano gracefully a polling REST
 * (vedi `useFileSync` realtimeStatus='error' → safety-net polling).
 * Per il push reattivo lato sala c'e' Sprint N3 (long-poll `/events/stream`).
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  if (getBackendMode() === 'desktop') {
    const info = getCachedDesktopBackendInfo();
    if (!info?.base_url || !info?.admin_token) {
      throw new Error(
        'Desktop backend non inizializzato: assicurarsi che `ensureDesktopBackendReady()` sia stato chiamato in `main.tsx` PRIMA del render.',
      );
    }
    browserClient = createClient<Database>(info.base_url, info.admin_token, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          apikey: info.admin_token,
          Authorization: `Bearer ${info.admin_token}`,
        },
      },
    });
    return browserClient;
  }

  if (!isSupabaseBrowserConfigured()) {
    throw new Error(
      'Manca la configurazione Supabase: impostare VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (vedi .env.example).',
    );
  }
  const url = import.meta.env.VITE_SUPABASE_URL!.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY!.trim();
  // Hardening commerciale (Sprint Q+1):
  //   - flowType: 'pkce'  → Authorization Code + PKCE (best practice SPA 2026,
  //     nessun token nell'URL hash, mitigation MITM su redirect OAuth).
  //   - storageKey         → namespace dedicato per evitare collisioni con
  //     altre app Supabase aperte sullo stesso dominio (utile per super-admin
  //     che apre piu' tenant in tab diverse: ognuno ha la propria sessione).
  //   - x-application-name → identificatore custom in Postgres logs / pgAudit
  //     per tracciare le query del frontend vs Edge Functions vs script.
  //   - eventsPerSecond=10 → rate-limit Realtime client-side per evitare flood
  //     accidentali di subscribe/unsubscribe in caso di re-render aggressivi.
  browserClient = createClient<Database>(url, key, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'sb-slidecenter-auth',
    },
    global: {
      headers: {
        'x-application-name': 'live-slide-center-web',
      },
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  return browserClient;
}
