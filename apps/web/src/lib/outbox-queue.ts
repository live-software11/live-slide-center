// ════════════════════════════════════════════════════════════════════════════
// Outbox queue IndexedDB — Audit-fix AU-08 (2026-04-18)
// ════════════════════════════════════════════════════════════════════════════
// Mini-libreria di outbox persistente per scritture best-effort che vogliamo
// rifare automaticamente quando torna la connettivita'.
//
// USO:
//   import { enqueueOutbox, startOutboxFlush } from '@/lib/outbox-queue';
//
//   // Quando una scrittura best-effort fallisce, accodala:
//   await enqueueOutbox({ kind: 'room_player_set_current', payload: {...} });
//
//   // All'avvio del PC sala, registra l'handler e avvia il flush:
//   startOutboxFlush({
//     room_player_set_current: async (payload) => {
//       await invokeRoomPlayerSetCurrent(payload.token, payload.presentationId);
//     },
//   });
//
// Il flush e' triggerato:
//   - all'avvio (subito)
//   - ogni 15s in background (per ritrasmettere quelli con next_attempt_at <= now)
//   - quando l'evento browser `online` viene emesso (ritorno connettivita')
//
// Backoff esponenziale: 5s, 10s, 20s, 40s, ... cap a 5 minuti. Cap attempts a
// 50 (oltre, considerato dead letter e cancellato dal DB con un warning).
//
// SICUREZZA / GDPR: i payload sono persistiti localmente in IndexedDB (origin
// app.liveslidecenter.com). Niente PII oltre quella gia' presente in
// presentation_id, device_token, ecc. Cleanup automatico delle dead letter.
//
// Compatibilita' SSR / non-browser: getDb() ritorna null se IndexedDB non
// disponibile, e tutti i metodi degradano a no-op.
// ════════════════════════════════════════════════════════════════════════════

const DB_NAME = 'slide-center-outbox';
const DB_VERSION = 1;
const STORE = 'outbox_v1';

const MAX_ATTEMPTS = 50;
const INITIAL_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;
const FLUSH_INTERVAL_MS = 15_000;

export interface OutboxItem<TPayload = unknown> {
  id?: number;
  kind: string;
  payload: TPayload;
  createdAt: number;
  nextAttemptAt: number;
  attempts: number;
  lastError?: string;
}

export type OutboxHandler<TPayload = unknown> = (payload: TPayload) => Promise<void>;
export type OutboxHandlerMap = Record<string, OutboxHandler<unknown>>;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let flushInterval: ReturnType<typeof setInterval> | null = null;
let onlineHandler: (() => void) | null = null;
let registeredHandlers: OutboxHandlerMap | null = null;
let flushInflight = false;

function getDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('by_next_attempt', 'nextAttemptAt');
          store.createIndex('by_kind', 'kind');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('[outbox-queue] IndexedDB open failed', req.error?.message);
        resolve(null);
      };
      req.onblocked = () => {
        console.warn('[outbox-queue] IndexedDB open blocked (other tabs?)');
        resolve(null);
      };
    } catch (err) {
      console.warn('[outbox-queue] IndexedDB unavailable', err);
      resolve(null);
    }
  });
  return dbPromise;
}

async function txAdd(item: OutboxItem): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  return new Promise<number | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.add(item);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => {
        console.warn('[outbox-queue] add failed', req.error?.message);
        resolve(null);
      };
    } catch (err) {
      console.warn('[outbox-queue] add tx failed', err);
      resolve(null);
    }
  });
}

async function txGetReady(now: number, limit = 50): Promise<OutboxItem[]> {
  const db = await getDb();
  if (!db) return [];
  return new Promise<OutboxItem[]>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const idx = store.index('by_next_attempt');
      const range = IDBKeyRange.upperBound(now);
      const req = idx.getAll(range, limit);
      req.onsuccess = () => resolve((req.result ?? []) as OutboxItem[]);
      req.onerror = () => {
        console.warn('[outbox-queue] getReady failed', req.error?.message);
        resolve([]);
      };
    } catch (err) {
      console.warn('[outbox-queue] getReady tx failed', err);
      resolve([]);
    }
  });
}

async function txDelete(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function txUpdate(item: OutboxItem): Promise<void> {
  const db = await getDb();
  if (!db || item.id === undefined) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Persiste l'item in coda. Non lancia: degrada a no-op se IndexedDB
 * non disponibile (es. tab privata, browser molto vecchio).
 */
export async function enqueueOutbox<T>(input: { kind: string; payload: T }): Promise<void> {
  const now = Date.now();
  const item: OutboxItem<T> = {
    kind: input.kind,
    payload: input.payload,
    createdAt: now,
    nextAttemptAt: now,
    attempts: 0,
  };
  await txAdd(item as OutboxItem);
}

/**
 * Esegue un round di flush su tutti gli item con `nextAttemptAt <= now`.
 * Idempotente: se chiamato in concorrenza, il secondo no-op (flag inflight).
 */
export async function flushOutboxOnce(handlers?: OutboxHandlerMap): Promise<{
  processed: number;
  succeeded: number;
  retried: number;
  dropped: number;
}> {
  const map = handlers ?? registeredHandlers ?? {};
  if (flushInflight) return { processed: 0, succeeded: 0, retried: 0, dropped: 0 };
  flushInflight = true;
  let processed = 0;
  let succeeded = 0;
  let retried = 0;
  let dropped = 0;
  try {
    const now = Date.now();
    const items = await txGetReady(now, 50);
    for (const item of items) {
      processed += 1;
      const handler = map[item.kind];
      if (!handler) {
        // Nessun handler registrato: rinvia di 30s (forse l'app non ha
        // ancora chiamato startOutboxFlush con questo kind).
        item.attempts += 1;
        item.nextAttemptAt = Date.now() + 30_000;
        if (item.attempts > MAX_ATTEMPTS) {
          await txDelete(item.id!);
          dropped += 1;
          console.warn('[outbox-queue] dropping unhandled kind', item.kind);
        } else {
          await txUpdate(item);
        }
        retried += 1;
        continue;
      }
      try {
        await handler(item.payload);
        await txDelete(item.id!);
        succeeded += 1;
      } catch (err) {
        item.attempts += 1;
        item.lastError = err instanceof Error ? err.message : 'unknown';
        const delay = Math.min(INITIAL_DELAY_MS * 2 ** (item.attempts - 1), MAX_DELAY_MS);
        item.nextAttemptAt = Date.now() + delay;
        if (item.attempts > MAX_ATTEMPTS) {
          await txDelete(item.id!);
          dropped += 1;
          console.warn('[outbox-queue] dropping after max attempts', item.kind, item.lastError);
        } else {
          await txUpdate(item);
          retried += 1;
        }
      }
    }
  } finally {
    flushInflight = false;
  }
  return { processed, succeeded, retried, dropped };
}

/**
 * Avvia il flush ricorrente in background. Idempotente: chiamare piu' volte
 * non duplica gli interval. Re-registra solo l'handler map.
 */
export function startOutboxFlush(handlers: OutboxHandlerMap): void {
  registeredHandlers = handlers;

  if (typeof window === 'undefined') return;

  // Online event: trigger immediato al ritorno della rete.
  if (!onlineHandler) {
    onlineHandler = () => {
      void flushOutboxOnce();
    };
    window.addEventListener('online', onlineHandler);
  }

  if (flushInterval !== null) return;
  flushInterval = setInterval(() => {
    void flushOutboxOnce();
  }, FLUSH_INTERVAL_MS);

  void flushOutboxOnce();
}

/** Stop scheduler (utile per test). */
export function stopOutboxFlush(): void {
  if (flushInterval !== null) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  registeredHandlers = null;
}

/** Conteggio item pendenti (per UI badge). */
export async function getOutboxPendingCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}
