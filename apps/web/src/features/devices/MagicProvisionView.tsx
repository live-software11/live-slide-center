// ════════════════════════════════════════════════════════════════════════════
// Sprint U-4 (UX V2.0) — MagicProvisionView (zero-friction PC sala)
// ════════════════════════════════════════════════════════════════════════════
//
// Route `/sala-magic/:token`. Il PC sala apre questo URL UNA volta sola
// (di solito via QR stampato o copiato dall'admin). Comportamento:
//
//   1. Estrae `token` dal path.
//   2. Chiama `claimRoomProvisionToken(token)` → riceve un pair_token
//      perpetuo legato al device appena creato lato server.
//   3. Salva un marker in localStorage cosi' un eventuale refresh non
//      ritenta il consume (single-use). Naviga `/sala/:pairToken`.
//
// Errori UX:
//   - token_invalid     → "Link non valido. Chiedi all'admin un nuovo magic link."
//   - token_expired     → "Link scaduto."
//   - token_revoked     → "Link revocato dall'admin."
//   - token_exhausted   → "Link gia' utilizzato (max usi raggiunto)."
//   - rate_limited      → "Troppi tentativi, riprova tra qualche minuto."
//   - other             → fallback "Errore di connessione".
// In tutti i casi mostriamo un bottone "Pairing manuale" che porta su /pair
// (codice 6 cifre, fallback robusto).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { claimRoomProvisionToken } from './repository';

type ClaimError =
  | 'token_invalid'
  | 'token_expired'
  | 'token_revoked'
  | 'token_exhausted'
  | 'rate_limited'
  | 'unknown';

const STORAGE_KEY_PREFIX = 'sc.magic-claim.';

export default function MagicProvisionView() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  // Stato iniziale derivato dal token (lazy initializer): se il token non e'
  // sintatticamente plausibile (mancante o troppo corto) finisce subito in
  // 'error'/token_invalid SENZA passare per setState dentro useEffect — cosi'
  // non scatta `react-hooks/set-state-in-effect`. La validazione semantica
  // (expired / revoked / exhausted) rimane lato server e arriva via .catch
  // della Promise (callback asincrono, regola non si applica).
  const tokenIsSyntacticallyValid = Boolean(token) && (token?.length ?? 0) >= 24;
  // Inizializzazione lazy: se il token e' sintatticamente valido partiamo
  // direttamente in 'claiming' (la chiamata RPC parte nell'effect immediato);
  // altrimenti 'error'. Cosi' eviiamo un setState dentro effect.
  const [phase, setPhase] = useState<'claiming' | 'error'>(
    () => (tokenIsSyntacticallyValid ? 'claiming' : 'error'),
  );
  const [error, setError] = useState<ClaimError>(
    () => (tokenIsSyntacticallyValid ? 'unknown' : 'token_invalid'),
  );

  useEffect(() => {
    if (startedRef.current) return;
    if (!tokenIsSyntacticallyValid || !token) {
      // Stato gia' inizializzato a 'error'/token_invalid via lazy initializer.
      // Non c'e' nulla da fare nell'effect: marca come avviato per evitare
      // ri-trigger su HMR.
      startedRef.current = true;
      return;
    }
    startedRef.current = true;

    const storageKey = STORAGE_KEY_PREFIX + token.slice(0, 16);
    // Anti-double-claim: se l'utente ricarica la pagina o torna indietro,
    // ricicliamo il pair_token che avevamo gia' ottenuto la prima volta.
    // Cosi' un refresh accidentale non bruciamo un'altra unita' di max_uses.
    let cached: string | null = null;
    try {
      cached = window.localStorage.getItem(storageKey);
    } catch {
      cached = null;
    }
    if (cached) {
      navigate(`/sala/${cached}`, { replace: true });
      return;
    }

    // `phase` e' gia' 'claiming' grazie al lazy initializer di useState; la
    // chiamata RPC parte qui sotto, gli eventuali setError/setPhase sono nel
    // .then/.catch (callback async, OK lato react-hooks/set-state-in-effect).
    void claimRoomProvisionToken({
      token,
      // Etichetta default. L'operatore di sala potra' rinominare il device
      // dalla RoomPlayerView ("Modifica nome").
      deviceName: navigator.platform || 'Sala',
    })
      .then((res) => {
        try {
          window.localStorage.setItem(storageKey, res.pair_token);
        } catch {
          // Storage pieno o disabilitato: continuiamo comunque, la nav
          // sotto e' single-use ma resta funzionante.
        }
        navigate(`/sala/${res.pair_token}`, { replace: true });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'unknown';
        const mapped: ClaimError =
          msg.includes('token_invalid') ? 'token_invalid'
          : msg.includes('token_expired') ? 'token_expired'
          : msg.includes('token_revoked') ? 'token_revoked'
          : msg.includes('token_exhausted') ? 'token_exhausted'
          : msg.includes('rate_limited') ? 'rate_limited'
          : 'unknown';
        setError(mapped);
        setPhase('error');
        if (msg.includes('exhausted') || msg.includes('expired') || msg.includes('revoked')) {
          // Cleanup di un eventuale cache orfana per evitare loop di
          // navigazione su /sala/<pair_token_invalid>.
          try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
        }
      });
  }, [token, tokenIsSyntacticallyValid, navigate]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {phase !== 'error' ? (
          <>
            <Loader2
              className="mx-auto h-10 w-10 animate-spin text-sc-accent mb-6"
              aria-hidden
            />
            <h1 className="text-2xl font-semibold tracking-tight mb-2">
              {t('magicProvision.preparing')}
            </h1>
            <p className="text-sc-text-secondary text-sm">
              {t('magicProvision.preparingDesc')}
            </p>
          </>
        ) : (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-sc-danger mb-6" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight mb-2">
              {t('magicProvision.errorTitle')}
            </h1>
            <p className="text-sc-text-secondary text-sm mb-8">
              {t(`magicProvision.error.${error}`)}
            </p>
            <button
              type="button"
              onClick={() => navigate('/pair', { replace: true })}
              className="inline-flex items-center gap-2 rounded-md bg-sc-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90 focus-visible:outline-2 focus-visible:outline-sc-accent"
            >
              {t('magicProvision.fallbackBtn')}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export { MagicProvisionView as Component };
