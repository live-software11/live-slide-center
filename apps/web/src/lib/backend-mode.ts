/**
 * Sprint J5 (GUIDA_OPERATIVA_v3 §4.B) — astrazione backend mode.
 *
 * La SPA puo' girare in due ambienti:
 *   • `cloud`   → backend Supabase remoto (Vercel hosting, default).
 *   • `desktop` → backend server Rust locale (Tauri 2 webview, Sprint K).
 *
 * Discriminante: `import.meta.env.VITE_BACKEND_MODE`. La build desktop (`vite build --mode desktop`)
 * forza `desktop` via `define` in `vite.config.ts`. La build cloud lascia il valore vuoto → cloud.
 *
 * In Sprint J questo modulo e' SOLO l'interruttore + la chip "DESKTOP / CLOUD" in header.
 * Lo shim REST verso `http://localhost:7300` arrivera' con Sprint K (server Rust + endpoint).
 */

export type BackendMode = 'cloud' | 'desktop';

/** Modalita backend rilevata a runtime. */
export function getBackendMode(): BackendMode {
  const raw = (import.meta.env.VITE_BACKEND_MODE ?? '').toString().trim().toLowerCase();
  return raw === 'desktop' ? 'desktop' : 'cloud';
}

/** True se l'app e' in esecuzione dentro Tauri webview (proxy: presenza dell'API `__TAURI_INTERNALS__`). */
export function isRunningInTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ??
    (window as unknown as { __TAURI__?: unknown }).__TAURI__,
  );
}

/**
 * URL effettivo del backend per la modalita corrente.
 * - cloud: VITE_SUPABASE_URL (default Vercel/Supabase).
 * - desktop: server Rust locale su `127.0.0.1:7300` (default Sprint K).
 */
export function getBackendBaseUrl(): string {
  if (getBackendMode() === 'desktop') {
    const override = import.meta.env.VITE_DESKTOP_BACKEND_URL;
    return (override ?? 'http://127.0.0.1:7300').toString().trim();
  }
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').toString().trim();
  return url;
}

/** Descrizione human-readable per la chip indicator in header (UI). */
export interface BackendDescriptor {
  mode: BackendMode;
  /** Chiave i18n per il label corto (es. `backendMode.short.cloud`). */
  shortKey: string;
  /** Chiave i18n per la descrizione lunga (tooltip). */
  hintKey: string;
  /** Token semantico colore da risolvere via Tailwind (sc-success/sc-primary/sc-warning/sc-danger). */
  tone: 'cloud' | 'desktop' | 'standalone';
}

export function getBackendDescriptor(): BackendDescriptor {
  const mode = getBackendMode();
  if (mode === 'desktop') {
    return {
      mode,
      shortKey: 'backendMode.short.desktop',
      hintKey: 'backendMode.hint.desktop',
      tone: 'desktop',
    };
  }
  return {
    mode,
    shortKey: 'backendMode.short.cloud',
    hintKey: 'backendMode.hint.cloud',
    tone: 'cloud',
  };
}

/**
 * Sprint W D1 — feature flag per le funzionalita' che esistono solo in cloud.
 *
 * Il backend desktop (server Rust + SQLite) e' nato come "cloud-parity offline":
 * mirror dello schema dei file e dei flussi base, ma alcune feature dipendono da
 * infrastrutture che il PC singolo non puo' replicare:
 *
 *   • `billing`            → checkout Lemon Squeezy + webhook → solo cloud.
 *   • `analytics`          → dashboard aggregata multi-evento basata su query
 *                            cloud che il SQLite locale non collezionerebbe in
 *                            modo significativo (1 evento per volta).
 *   • `marketing`          → pagine pubbliche, share link → richiede dominio cloud.
 *   • `tenant-admin`       → gestione utenti/ruoli/inviti tenant → solo cloud.
 *   • `cloud-presence`     → presence presenter cross-rete → richiede Realtime Supabase.
 *   • `cross-event-search` → ricerca full-text multi-evento → solo cloud.
 *   • `device-telemetry`   → dashboard health PC sala remoti → in desktop il
 *                            singolo PC sa di se stesso, non serve dashboard.
 *   • `audit-log-export`   → export audit log multi-evento → solo cloud.
 *
 * Le feature di gestione locale (event/room/sessions/upload/folders/devices LAN)
 * funzionano IDENTICHE in desktop: NON vanno marcate cloud-only.
 *
 * Uso tipico in TSX:
 *
 *   if (!isCloudFeatureAvailable('billing')) return <FeatureNotAvailableView feature="billing" />;
 *
 * Oppure come route guard:
 *
 *   <RequireCloudFeature feature="billing"><BillingPage /></RequireCloudFeature>
 */
export type CloudOnlyFeature =
  | 'billing'
  | 'analytics'
  | 'marketing'
  | 'tenant-admin'
  | 'cloud-presence'
  | 'cross-event-search'
  | 'device-telemetry'
  | 'audit-log-export';

/**
 * Restituisce `true` se la feature richiesta e' disponibile nel backend
 * corrente. In modalita cloud → sempre `true`. In modalita desktop →
 * `false` per le feature elencate in `CloudOnlyFeature`.
 *
 * Il parametro `feature` resta nel tipo per documentazione e per evolvere
 * la funzione in futuro (es. abilitare in desktop alcune feature
 * specifiche). Oggi e' una blacklist piatta su tutto l'union type.
 */
export function isCloudFeatureAvailable(feature: CloudOnlyFeature): boolean {
  if (getBackendMode() === 'cloud') return true;
  // In desktop blocchiamo TUTTE le feature elencate. La whitelist e' chiusa:
  // se in futuro una feature diventa portabile in desktop, basta aggiungerla
  // alla `desktopAllowed` set qui sotto.
  const desktopAllowed: ReadonlySet<CloudOnlyFeature> = new Set();
  return desktopAllowed.has(feature);
}
