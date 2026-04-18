/**
 * Sprint T-3-E (G10) — LRU cache in-memory minima.
 *
 * Usata da `lib/thumbnail.ts` per cachare i thumbnail generati lato client
 * (PDF via pdf.js, PPTX via JSZip). L'idea e' tenere su qualche decina di
 * thumb per evitare di rigenerarli ogni volta che la dashboard ridisegna,
 * senza saturare la RAM dei PC tecnici (alcuni eventi hanno >100 file).
 *
 * Implementazione: sfrutta l'ordine di inserimento garantito da `Map` in
 * JavaScript moderno. Ad ogni `get`, se la chiave esiste la spostiamo in
 * coda (delete + set) per marcarla come "recently used". Quando si supera
 * la capacita' espelliamo la prima chiave (la meno recente).
 *
 * Zero dipendenze, zero allocazioni nel hot path tranne quella della
 * coppia [delete + set] sul `get` hit.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0 || !Number.isFinite(capacity)) {
      throw new Error('LRUCache capacity must be a positive finite number');
    }
    this.capacity = Math.floor(capacity);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Sposta in coda ricreando l'inserimento.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict il piu' vecchio: prima chiave dell'iteratore.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /**
   * Iteratore sui valori in ordine di insert (vecchio → recente).
   * Esposto per consentire al chiamante (es. cache thumbnail con blob URL)
   * di liberare risorse prima di un `clear()`.
   */
  *values(): IterableIterator<V> {
    for (const v of this.map.values()) yield v;
  }
}
