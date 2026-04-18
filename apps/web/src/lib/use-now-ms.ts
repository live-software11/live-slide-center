// ════════════════════════════════════════════════════════════════════════════
// useNowMs — clock derivato per UI dipendenti dal tempo (Sprint U-3 / U-4)
// ════════════════════════════════════════════════════════════════════════════
//
// Restituisce un timestamp epoch ms aggiornato a intervalli fissi. Serve per
// componenti che mostrano "iniziato N minuti fa" o "scade tra...". Senza
// questo hook le componenti chiamerebbero `Date.now()` direttamente in render
// — pattern impuro flaggato da `react-hooks/purity` perche' il valore cambia
// ad ogni re-render in modo non deterministico.
//
// Uso:
//   const nowMs = useNowMs(5000);          // tick ogni 5 secondi (UI live)
//   const nowMs = useNowMs(60_000);        // tick ogni minuto (scadenze)
//
// L'hook NON forza re-render extra: il `setInterval` viene smontato quando il
// componente lascia il DOM. Resto stabile tra i tick (referential equality
// del numero) per non rompere memo dipendenti.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';

export function useNowMs(intervalMs: number): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
