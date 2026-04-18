/**
 * Sprint L + M + P (GUIDA_OPERATIVA_v3 §4.D + §4.E + §4.H) — bridge tipato verso i Tauri commands.
 *
 * Tutte le chiamate `invoke()` passano per questo modulo cosi' che:
 *   • il caller non importa direttamente `@tauri-apps/api/core` (non serve)
 *     ma usa `window.__TAURI__.core.invoke` esposto dalla webview Tauri
 *     (`withGlobalTauri = true` in `tauri.conf.json`),
 *   • le chiamate fatte in modalita cloud non crashano: ritornano `null` o
 *     buttano un errore "non Tauri" tracciabile,
 *   • il typing dei command (input/output) e' centralizzato qui: chi modifica
 *     `main.rs` aggiorna anche i tipi sotto.
 *
 * Comandi esposti dal backend Rust (vedi `apps/desktop/src-tauri/src/main.rs`):
 *   - cmd_app_info()                                         → AppInfo (Sprint J)
 *   - cmd_backend_info()                                     → BackendInfo (Sprint K + L)
 *   - cmd_get_role()                                         → { role: 'admin' | 'sala' | null }
 *   - cmd_set_role(role: 'admin' | 'sala')                   → { ok, role, requires_restart }
 *   - cmd_discover_lan_pcs(role_filter, timeout_ms, exclude_self) → DiscoverResult
 *   - cmd_get_persisted_device()                             → { device | null } (Sprint M2)
 *   - cmd_clear_device_pairing()                             → { ok, had_device_json } (Sprint M3)
 *   - cmd_updater_status()                                   → { configured, current_version } (Sprint P3)
 *   - cmd_check_for_update()                                 → { available, version?, ... } (Sprint P3)
 *   - cmd_install_update_and_restart()                       → never (la app si chiude e riparte)
 */

import { isRunningInTauri } from './backend-mode';

// `window.__TAURI__` viene iniettato dalla webview Tauri quando `app.withGlobalTauri = true`.
// Lo dichiariamo come typed accessor, evitando un `(window as any)` ovunque.
type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
interface TauriGlobals {
  core?: { invoke?: TauriInvoke };
}

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isRunningInTauri()) {
    return Promise.reject(new Error(`tauri_not_available: cannot invoke '${cmd}' outside Tauri webview`));
  }
  const t = (window as unknown as { __TAURI__?: TauriGlobals }).__TAURI__;
  const invoke = t?.core?.invoke;
  if (typeof invoke !== 'function') {
    return Promise.reject(
      new Error(
        `tauri_global_missing: window.__TAURI__.core.invoke not exposed (set withGlobalTauri=true)`,
      ),
    );
  }
  return invoke<T>(cmd, args);
}

// ── Sprint K1 — backend info ──────────────────────────────────────────────
export interface DesktopBackendInfo {
  ready: boolean;
  base_url?: string;
  port?: number;
  admin_token?: string;
  data_root?: string;
  storage_root?: string;
  /** Sprint L: ruolo nodo (`admin` | `sala`). */
  role?: 'admin' | 'sala';
  /** Sprint L: true se il publisher mDNS ha potuto pubblicare sulla LAN. */
  mdns_active?: boolean;
  /**
   * Sprint L3: IPv4 LAN dell'admin. Usato dalla SPA per costruire
   * `admin_server.base_url` quando fa pair-direct verso un PC sala
   * (`127.0.0.1` non sarebbe richiamabile dall'altro PC).
   */
  lan_addresses?: string[];
}

/** Ritorna il backend info; in modalita cloud ritorna `{ ready: false }`. */
export async function getDesktopBackendInfo(): Promise<DesktopBackendInfo> {
  if (!isRunningInTauri()) return { ready: false };
  try {
    return await tauriInvoke<DesktopBackendInfo>('cmd_backend_info');
  } catch {
    return { ready: false };
  }
}

/**
 * Helper: costruisce l'URL base raggiungibile dalla LAN per il server admin
 * locale (es. `http://192.168.1.10:7300`). Restituisce `null` se non siamo in
 * Tauri o se il backend non ha individuato nessun IP LAN (rete down,
 * computer in modalita aereo, ...).
 *
 * **Selezione IP**: prendiamo il primo della lista (in mDNS publish gli IP
 * sono raccolti via UDP test "verso 8.8.8.8" → primo IP = NIC default del
 * sistema). Se sull'host ci sono piu' NIC, l'utente puo' definire la NIC
 * preferita lato OS (Windows: ordine binding adapter).
 */
export function getAdminLanBaseUrl(info: DesktopBackendInfo): string | null {
  if (!info.ready || !info.port) return null;
  const ips = info.lan_addresses ?? [];
  const first = ips[0];
  if (!first) return null;
  return `http://${first}:${info.port}`;
}

// ── Sprint L1 — ruolo nodo (admin | sala) ────────────────────────────────
export type NodeRole = 'admin' | 'sala';

interface RoleResponse {
  role: NodeRole | null;
}

/** Ritorna `null` quando l'utente non ha ancora scelto (mostra `RoleSelectionView`). */
export async function getDesktopRole(): Promise<NodeRole | null> {
  if (!isRunningInTauri()) return null;
  try {
    const r = await tauriInvoke<RoleResponse>('cmd_get_role');
    return r.role ?? null;
  } catch {
    return null;
  }
}

interface SetRoleResponse {
  ok: boolean;
  role: NodeRole;
  requires_restart: boolean;
}

/** Persiste il ruolo. Tauri risponde con `requires_restart: true` (sempre, in Sprint L). */
export async function setDesktopRole(role: NodeRole): Promise<SetRoleResponse> {
  return tauriInvoke<SetRoleResponse>('cmd_set_role', { role });
}

// ── Sprint L3 — discovery mDNS one-shot ───────────────────────────────────
export interface DiscoveredLanNode {
  fullname: string;
  name: string;
  hostname: string;
  addresses: string[];
  port: number;
  role: 'admin' | 'sala' | string;
  event_id: string | null;
  app_version: string | null;
  resolved_at_ms: number;
}

interface DiscoverResult {
  ok: boolean;
  count: number;
  nodes: DiscoveredLanNode[];
}

export interface DiscoverOptions {
  /** Filtra solo i nodi con questo ruolo (`'sala'` per "Aggiungi PC LAN"). */
  roleFilter?: 'admin' | 'sala';
  /** Durata browse mDNS in ms (default 1500ms). */
  timeoutMs?: number;
  /** Esclude il nodo locale dai risultati (default true). */
  excludeSelf?: boolean;
}

/**
 * Esegue una discovery mDNS one-shot e ritorna la lista di nodi visibili. In
 * modalita cloud ritorna `{ ok: false, count: 0, nodes: [] }` (no Tauri).
 */
export async function discoverLanNodes(opts: DiscoverOptions = {}): Promise<DiscoverResult> {
  if (!isRunningInTauri()) return { ok: false, count: 0, nodes: [] };
  try {
    return await tauriInvoke<DiscoverResult>('cmd_discover_lan_pcs', {
      roleFilter: opts.roleFilter ?? null,
      timeoutMs: opts.timeoutMs ?? null,
      excludeSelf: opts.excludeSelf ?? null,
    });
  } catch {
    return { ok: false, count: 0, nodes: [] };
  }
}

// ── Sprint L3/L4 — pair-direct verso un PC sala scoperto ──────────────────
export interface PairDirectInput {
  /** URL base del PC sala (es. `http://192.168.1.42:7300`). */
  targetBaseUrl: string;
  event_id: string;
  event_name?: string;
  room_id?: string;
  room_name?: string;
  device_name?: string;
  /** Info del server admin che fa il pairing (per device.json sul PC sala). */
  admin_server: {
    base_url: string;
    name?: string;
  };
}

export interface PairDirectResponse {
  device_token: string;
  device_id: string;
  device_name: string;
  event_id: string;
  room_id: string | null;
  paired_at: string;
}

/**
 * Chiama `POST /functions/v1/pair-direct` sul PC sala scoperto via mDNS. Usa
 * `fetch()` standard: l'Axum lato sala ha CORS very_permissive (Sprint K1).
 *
 * Errori HTTP vengono trasformati in `Error` con il code letto dal body
 * (`{ error, message }` formato `AppError`). `409 Conflict` (device gia' paired)
 * propaga il code per consentire alla UI di mostrare "PC gia' paired, vuoi unpair?".
 */
export async function pairDirectLan(input: PairDirectInput): Promise<PairDirectResponse> {
  const base = input.targetBaseUrl.replace(/\/+$/, '');
  const body = {
    event_id: input.event_id,
    event_name: input.event_name,
    room_id: input.room_id,
    room_name: input.room_name,
    device_name: input.device_name,
    admin_server: input.admin_server,
    user_agent: navigator.userAgent,
    browser: navigator.userAgent.includes('Chrome') ? 'chrome' : 'webview',
  };
  const res = await fetch(`${base}/functions/v1/pair-direct`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = 'http_error';
    let message = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (typeof j?.error === 'string') code = j.error;
      if (typeof j?.message === 'string') message = j.message;
    } catch {
      /* ignore */
    }
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as PairDirectResponse;
}

// ── Sprint M2 — device.json persistito (auto-rejoin) ──────────────────────
/**
 * Snapshot di `~/SlideCenter/device.json` letto via Tauri. Tutte le info
 * necessarie al PC sala per ricomporre la sessione al riavvio senza chiedere
 * di nuovo il pairing (regola sovrana 4).
 */
export interface PersistedDevice {
  device_id: string;
  device_token: string;
  device_name: string;
  event_id: string;
  room_id: string | null;
  admin_server: {
    base_url: string;
    name: string | null;
    fingerprint: string | null;
  } | null;
  paired_at: string;
  app_version: string;
}

interface PersistedDeviceResponse {
  ok: boolean;
  device: PersistedDevice | null;
}

/**
 * Ritorna il device persistito sul disco (Sprint M2). In modalita cloud o se
 * non e' mai stato fatto pair-direct ritorna `null`.
 */
export async function getPersistedDevice(): Promise<PersistedDevice | null> {
  if (!isRunningInTauri()) return null;
  try {
    const r = await tauriInvoke<PersistedDeviceResponse>('cmd_get_persisted_device');
    return r.device ?? null;
  } catch {
    return null;
  }
}

// ── Sprint M3 — esci dall'evento / pair-revoke ────────────────────────────
interface ClearDeviceResponse {
  ok: boolean;
  had_device_json: boolean;
}

/**
 * Cancella `device.json` + riga paired_devices locale + reset TXT mDNS.
 *
 * Chiamata da `RoomPlayerView` quando l'utente fa "Esci dall'evento" sul PC
 * sala. Idempotente: in cloud o senza device.json ritorna `{ had_device_json: false }`.
 *
 * **Importante**: la SPA dopo questo cmd deve anche cancellare `localStorage`
 * (`device_token`, `device_id`) e navigare a `/pair`. Lo fa il caller.
 */
export async function clearDevicePairing(): Promise<ClearDeviceResponse> {
  if (!isRunningInTauri()) return { ok: true, had_device_json: false };
  try {
    return await tauriInvoke<ClearDeviceResponse>('cmd_clear_device_pairing');
  } catch {
    return { ok: false, had_device_json: false };
  }
}

// ── Sprint N1 — registra paired device sul backend admin locale ───────────
//
// Quando l'admin completa un `pair-direct` verso un PC sala, la riga viene
// inserita nel SQLite **del PC sala** (lato `pair_direct`). Per il fan-out
// HTTP (Sprint N1: notify_paired_devices) il backend admin deve a sua volta
// avere l'entry in `paired_devices` con `lan_base_url` valorizzata.
//
// Strategia: la SPA admin chiama `POST /rest/v1/paired_devices` sul **proprio**
// backend locale (via `info.base_url` + `info.admin_token`) con:
//   - id            = device_id ricevuto da pair-direct (cosi' identico)
//   - event_id      = event corrente
//   - room_id?
//   - device_name
//   - device_type   = "lan_pc" (etichetta semantica per la lista admin)
//   - browser, user_agent (best-effort, dal navigator)
//   - pair_token_hash = SHA-256 hex del device_token (stesso algo lato sala)
//   - lan_base_url  = URL del PC sala (es. http://192.168.1.42:7300)
//   - status        = 'online'
//
// In errore (admin offline / 403 / 409) NON blocchiamo il pair: l'admin SPA
// resta funzionale ma il fan-out non andra' a buon fine fino al prossimo
// re-pair. Loghiamo l'errore per troubleshooting.
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface RegisterPairedDeviceLocalArgs {
  /** Backend info admin (`info.base_url` + `info.admin_token`). */
  admin: { base_url: string; admin_token?: string };
  device_id: string;
  device_token: string;
  event_id: string;
  room_id?: string | null;
  device_name: string;
  /** Default `'lan_pc'`. */
  device_type?: string;
  lan_base_url: string;
}

/**
 * Sprint N1 — registra il device LAN nel SQLite locale dell'admin (REST POST).
 *
 * Best-effort: ritorna `{ ok: false }` su errore senza buttare. Il caller
 * decide se mostrare un warning all'utente.
 */
export async function registerPairedDeviceOnAdminLocal(
  args: RegisterPairedDeviceLocalArgs,
): Promise<{ ok: boolean; status: number; code?: string; message?: string }> {
  if (!args.admin.base_url || !args.admin.admin_token) {
    return { ok: false, status: 0, code: 'admin_token_missing' };
  }
  let pair_token_hash: string;
  try {
    pair_token_hash = await sha256Hex(args.device_token);
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: 'hash_failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const base = args.admin.base_url.replace(/\/+$/, '');
  const body = {
    id: args.device_id,
    event_id: args.event_id,
    room_id: args.room_id ?? null,
    device_name: args.device_name,
    device_type: args.device_type ?? 'lan_pc',
    browser: navigator.userAgent.includes('Chrome') ? 'chrome' : 'webview',
    user_agent: navigator.userAgent,
    pair_token_hash,
    lan_base_url: args.lan_base_url,
    status: 'online',
  };
  try {
    const res = await fetch(`${base}/rest/v1/paired_devices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.admin.admin_token}`,
        // Prefer return=representation: il REST shim risponde con la riga inserita
        prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let code = 'http_error';
      let message = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (typeof j?.error === 'string') code = j.error;
        if (typeof j?.message === 'string') message = j.message;
      } catch {
        /* body vuoto, va bene */
      }
      return { ok: false, status: res.status, code, message };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: 'network_error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Sprint N2 — signed URL LAN per download dal admin ────────────────────
//
// In modalita LAN il PC sala scarica i file direttamente dallo storage locale
// del PC admin. Il PC sala possiede `device_token` (dal `device.json`) ma NON
// possiede l'`admin_token` HTTP del backend admin (che e' un secret per-host).
//
// Per ottenere un signed URL HMAC valido per il bucket `presentations` chiama
// `POST {adminBaseUrl}/functions/v1/lan-sign-url` con `{ device_token,
// storage_key, bucket }`. Il backend admin (vedi `routes/functions.rs::lan_sign_url`)
// valida che il `device_token` sia in `paired_devices` con event_id matchante
// la presentazione, e ritorna un URL firmato direttamente scaricabile via GET.
export interface LanSignUrlResponse {
  signedURL: string;
  path: string;
  expiresIn: number;
}

export async function signLanDownloadUrl(args: {
  adminBaseUrl: string;
  device_token: string;
  storage_key: string;
  bucket?: string;
  expires_in?: number;
}): Promise<LanSignUrlResponse> {
  const base = args.adminBaseUrl.replace(/\/+$/, '');
  const body: Record<string, unknown> = {
    device_token: args.device_token,
    storage_key: args.storage_key,
    bucket: args.bucket ?? 'presentations',
  };
  if (typeof args.expires_in === 'number') body.expires_in = args.expires_in;
  const res = await fetch(`${base}/functions/v1/lan-sign-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = 'http_error';
    let message = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (typeof j?.error === 'string') code = j.error;
      if (typeof j?.message === 'string') message = j.message;
    } catch {
      /* body vuoto */
    }
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as LanSignUrlResponse;
}

// ── Sprint N3 — long-poll degli eventi LAN dal proprio backend ─────────────
//
// Il PC sala in modalita LAN espone un piccolo bus eventi locale: quando il
// backend riceve un push HTTP dal admin (`POST /events/file_added`) lo salva
// in un ring buffer e lo distribuisce via long-poll su `GET /events/stream?since=N`.
// La SPA del sala usa questo long-poll per reagire in tempo reale: quando
// arriva un `file_added` chiama `refreshNow()` di useFileSync per scaricare
// il nuovo file.
//
// Long-poll vs SSE: long-poll perche'
//   1) riusa fetch standard senza dipendenze EventSource (Tauri webview e'
//      una webview a tutti gli effetti, ma la fetch e' meno fragile),
//   2) cancellazione pulita via AbortController (su unmount component),
//   3) timeout 25s sul server: la connessione si chiude regolarmente anche
//      senza eventi, evitando proxy/nat che chiudono dopo 60s.
export type LanEventKind = 'file_added' | 'presentation_deleted';
export interface LanEvent<TPayload = Record<string, unknown>> {
  id: number;
  at: string;
  payload: TPayload & { kind: LanEventKind };
}

export interface LanStreamResponse {
  events: LanEvent[];
  cursor: number;
}

export async function fetchLanEvents(args: {
  baseUrl: string;
  since: number;
  timeoutMs?: number;
  eventId?: string;
  signal?: AbortSignal;
}): Promise<LanStreamResponse> {
  const base = args.baseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/events/stream`);
  url.searchParams.set('since', String(args.since));
  if (typeof args.timeoutMs === 'number') {
    url.searchParams.set('timeout_ms', String(args.timeoutMs));
  }
  if (args.eventId) {
    url.searchParams.set('event_id', args.eventId);
  }
  const res = await fetch(url.toString(), { signal: args.signal });
  if (!res.ok) {
    throw new Error(`lan_events_${res.status}`);
  }
  return (await res.json()) as LanStreamResponse;
}

/**
 * Chiama `POST /functions/v1/pair-revoke` su un PC sala via LAN (Sprint M3).
 *
 * Usato lato admin in `revokeDevice()` quando in modalita desktop il PC sala
 * ha un `lan_base_url` salvato. Il sala valida `device_token` contro
 * `device.json` e cancella il pairing remotamente.
 *
 * Best-effort: se il sala e' offline (LAN giu', PC spento) l'admin cancella
 * comunque il record dal proprio DB locale (l'utente e' avvisato che il sala
 * potrebbe ricomparire al prossimo avvio se non si riesce a contattarlo).
 *
 * Timeout 4s (LAN tipica < 200ms; se sforiamo, il sala e' down → fallback).
 */
export async function pairRevokeLan(args: {
  targetBaseUrl: string;
  device_token?: string;
  device_id?: string;
  event_id?: string;
}): Promise<{ ok: boolean; status: number; code?: string }> {
  const base = args.targetBaseUrl.replace(/\/+$/, '');
  const body: Record<string, string> = {};
  if (args.device_token) body.device_token = args.device_token;
  if (args.device_id) body.device_id = args.device_id;
  if (args.event_id) body.event_id = args.event_id;
  if (!body.device_token && !(body.device_id && body.event_id)) {
    return { ok: false, status: 0, code: 'missing_args' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${base}/functions/v1/pair-revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let code = 'http_error';
      try {
        const j = await res.json();
        if (typeof j?.error === 'string') code = j.error;
      } catch {
        /* ignore */
      }
      return { ok: false, status: res.status, code };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network_error';
    return { ok: false, status: 0, code: message.includes('abort') ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

// ── Sprint P3 (GUIDA_OPERATIVA_v3 §4.H) — Tauri updater bridge ────────────
//
// Tre commands Rust chiamati da `<DesktopUpdateBanner />` per check + install
// degli aggiornamenti distribuiti via GitHub Releases (account live-software11).
// In cloud (no Tauri) i wrappers ritornano sempre `{ configured: false }` /
// `{ available: false }` cosi' la UI non rompe e il banner resta nascosto.

export interface UpdaterStatus {
  configured: boolean;
  current_version: string;
  endpoint_hint?: string;
}

export interface UpdateCheckResult {
  available: boolean;
  /** Presente solo se `available=true`. */
  version?: string;
  /** Presente sempre. */
  current_version?: string;
  /** ISO 8601 di pubblicazione dal manifest `latest.json`. */
  date?: string | null;
  /** Release notes in markdown (dal `latest.json` Tauri). */
  body?: string | null;
  /** Codice errore parlante (es. `check_failed: ...`). Presente solo on error. */
  error?: string;
}

/**
 * Stato configurazione updater. In cloud ritorna `configured: false` cosi' la
 * UI non mostra il banner. Su desktop ritorna sempre `configured: true` ma il
 * vero check graceful e' nel `checkForUpdate()`.
 */
export async function getUpdaterStatus(): Promise<UpdaterStatus> {
  if (!isRunningInTauri()) {
    return { configured: false, current_version: 'cloud' };
  }
  try {
    return await tauriInvoke<UpdaterStatus>('cmd_updater_status');
  } catch {
    return { configured: false, current_version: 'unknown' };
  }
}

/**
 * Check remoto sull'endpoint configurato (`tauri.conf.json -> plugins.updater.endpoints`).
 *
 * **Sempre safe**: in caso di rete giu', endpoint 404 (no release pubblicate),
 * pubkey mismatch o updater non configurato, ritorna `{ available: false,
 * error: "..." }` SENZA buttare. Il caller decide se mostrare il banner.
 *
 * In cloud (no Tauri) ritorna `{ available: false }`.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isRunningInTauri()) {
    return { available: false };
  }
  try {
    return await tauriInvoke<UpdateCheckResult>('cmd_check_for_update');
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : 'check_failed',
    };
  }
}

/**
 * Scarica + installa l'update + restart dell'app. Su Windows l'installer NSIS
 * passa in modalita `passive` (window con progress). Dopo questa chiamata la
 * SPA muore: NON serve aggiornare lo state.
 *
 * **Sempre safe**: in cloud ritorna `{ ok: false, error: "not_desktop" }`.
 * On error desktop (rete giu' a meta', signature invalid) ritorna `{ ok:
 * false, error: "..." }` senza buttare.
 */
export async function installUpdateAndRestart(): Promise<{ ok: boolean; error?: string }> {
  if (!isRunningInTauri()) {
    return { ok: false, error: 'not_desktop' };
  }
  try {
    await tauriInvoke<unknown>('cmd_install_update_and_restart');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'install_failed',
    };
  }
}

// ── Sprint D1 — Sistema licenze unificato cloud/desktop ───────────────────
//
// Quattro commands Rust (vedi `apps/desktop/src-tauri/src/license/commands.rs`)
// che la SPA usa per:
//   1. mostrare lo stato licenza nel banner / pagina dedicata
//   2. fare il bind iniziale (incolla magic-link → ottieni pair_token cifrato)
//   3. heartbeat manuale ("Verifica ora")
//   4. scollegare il PC ("Reset licenza")
//
// In cloud (no Tauri) tutte ritornano `notBound` graceful — l'UI dovrebbe
// nascondere il modulo intero quando `isRunningInTauri()` e' false.

export type DesktopLicenseStatus =
  | { kind: 'notBound' }
  | {
    kind: 'active';
    tenantName?: string | null;
    plan?: string | null;
    expiresAt?: string | null;
    lastVerifiedAt: string;
  }
  | {
    /** Sprint SR — pair_token in scadenza (≤ 7gg). App attiva, banner giallo. */
    kind: 'pairTokenExpiring';
    tenantName?: string | null;
    plan?: string | null;
    expiresAt?: string | null;
    lastVerifiedAt: string;
    pairTokenExpiresAt: string;
    pairTokenDaysRemaining: number;
  }
  | {
    /** Sprint SR — pair_token scaduto: serve re-bind admin. */
    kind: 'pairTokenExpired';
    tenantName?: string | null;
    lastVerifiedAt: string;
    pairTokenExpiresAt: string;
  }
  | {
    kind: 'gracePeriod';
    tenantName?: string | null;
    plan?: string | null;
    lastVerifiedAt: string;
    graceUntil: string;
    daysRemaining: number;
  }
  | {
    kind: 'graceExpired';
    tenantName?: string | null;
    lastVerifiedAt: string;
  }
  | { kind: 'revoked' }
  | { kind: 'tenantSuspended'; tenantName?: string | null }
  | { kind: 'error'; message: string };

export async function getDesktopLicenseStatus(): Promise<DesktopLicenseStatus> {
  if (!isRunningInTauri()) return { kind: 'notBound' };
  try {
    return await tauriInvoke<DesktopLicenseStatus>('cmd_license_status');
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'unknown_error' };
  }
}

export async function bindDesktopLicense(args: {
  magicLink: string;
  deviceName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isRunningInTauri()) return { ok: false, error: 'not_desktop' };
  try {
    await tauriInvoke<unknown>('cmd_license_bind', {
      magicLink: args.magicLink,
      deviceName: args.deviceName ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'bind_failed' };
  }
}

export async function verifyDesktopLicenseNow(): Promise<{
  ok: boolean;
  status?: DesktopLicenseStatus;
  error?: string;
}> {
  if (!isRunningInTauri()) return { ok: false, error: 'not_desktop' };
  try {
    const r = await tauriInvoke<{ ok: boolean; status?: DesktopLicenseStatus }>(
      'cmd_license_verify_now',
    );
    return { ok: !!r?.ok, status: r?.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'verify_failed' };
  }
}

/**
 * Sprint SR — rotazione manuale del pair_token.
 *
 * Da chiamare dal banner "Rinnova ora" quando lo stato è `pairTokenExpiring`.
 * Genera un nuovo pair_token random lato Tauri, lo registra atomicamente
 * server-side (`desktop-license-renew`) e aggiorna `license.enc`.
 *
 * Errori comuni:
 *   - `pair_token_expired`: chiamata troppo tardi → serve re-bind admin
 *   - `device_revoked`: admin ha revocato il device → re-bind o nuovo PC
 *   - `network_error`: offline → riprova quando torna la connessione
 */
export async function renewDesktopLicenseNow(): Promise<{
  ok: boolean;
  status?: DesktopLicenseStatus;
  error?: string;
}> {
  if (!isRunningInTauri()) return { ok: false, error: 'not_desktop' };
  try {
    const r = await tauriInvoke<{ ok: boolean; status?: DesktopLicenseStatus }>(
      'cmd_license_renew_now',
    );
    return { ok: !!r?.ok, status: r?.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'renew_failed' };
  }
}

export async function resetDesktopLicense(): Promise<{ ok: boolean; error?: string }> {
  if (!isRunningInTauri()) return { ok: false, error: 'not_desktop' };
  try {
    await tauriInvoke<unknown>('cmd_license_reset');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'reset_failed' };
  }
}

// ── Sprint Z (post-field-test) Gap C — last session persistente PC sala ──
//
// La SPA in modalita Tauri (PC sala desktop) salva qui lo stato runtime
// "ultima session/presentation/slide proiettata" nel filesystem locale.
// Al prossimo boot il modulo `useLastSession` legge questo blob e fa il
// restore puntuale, evitando il "buco nero" in caso di crash/blackout
// durante l'evento.
//
// In modalita cloud (browser puro) i due wrapper sono no-op:
//   - `getLastSession()` ritorna sempre `null`
//   - `saveLastSession()` ritorna sempre `{ ok: false, error: 'not_desktop' }`
//
// Schema versione 1: aggiornare in tandem con `session_store.rs` se cambia.

export interface LastSession {
  /** Schema version (1 al momento). Mismatch → restore skippato lato Rust. */
  schema: number;
  device_token: string;
  event_id: string;
  room_id: string | null;
  current_presentation_id: string | null;
  current_session_id: string | null;
  current_slide_index: number | null;
  current_slide_total: number | null;
  /** ISO 8601 dell'ultimo save. */
  saved_at: string;
}

interface LastSessionResponse {
  ok: boolean;
  session: LastSession | null;
}

/** Tauri-only. In cloud ritorna `null`. */
export async function getLastSession(): Promise<LastSession | null> {
  if (!isRunningInTauri()) return null;
  try {
    const r = await tauriInvoke<LastSessionResponse>('cmd_get_last_session');
    return r.session ?? null;
  } catch {
    return null;
  }
}

/** Tauri-only. In cloud ritorna `{ ok: false, error: 'not_desktop' }`. */
export async function saveLastSession(payload: LastSession): Promise<{ ok: boolean; error?: string }> {
  if (!isRunningInTauri()) return { ok: false, error: 'not_desktop' };
  try {
    await tauriInvoke<unknown>('cmd_save_last_session', { payload });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'save_failed' };
  }
}
