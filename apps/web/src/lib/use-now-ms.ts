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
// Audit-fix Sprint U-5+1 (G1+G2):
//   - L'intervallo si SOSPENDE quando il tab e' nascosto (visibilitychange).
//     Prima girava sempre, anche su tab in background di laptop in batteria
//     => 1 timer ogni 5s × N componenti aperti × N tab = spreco CPU/batteria
//     misurabile (Chrome throttla ma non azzera).
//   - Al ritorno foreground, refresh IMMEDIATO del valore + restart interval.
//     Senza questo, l'utente che torna alla regia dopo 30 min vedrebbe
//     "Avviato 5s fa" finche' il prossimo tick non scatta (UX confusa).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';

export function useNowMs(intervalMs: number): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    let intervalId: number | null = null;

    const startInterval = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stopInterval = () => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopInterval();
      } else {
        // G2: refresh immediato al ritorno foreground (vedi commento sopra).
        setNow(Date.now());
        startInterval();
      }
    };

    if (!document.hidden) {
      startInterval();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
  return now;
}
