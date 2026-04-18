import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { isRunningInTauri } from '@/lib/backend-mode';
import { getDesktopRole, getPersistedDevice, type NodeRole } from '@/lib/desktop-bridge';
import { RoleSelectionView } from '@/features/desktop/RoleSelectionView';

const STORED_TOKEN_KEY = 'device_token';
const STORED_DEVICE_ID_KEY = 'device_id';

/**
 * Sprint L1 + M2 (GUIDA_OPERATIVA_v3 §4.D L1 + §4.E M2) — gate che precede
 * tutta la SPA in modalita desktop.
 *
 * Logica:
 *   • In modalita cloud (browser, no Tauri): no-op, monta direttamente <Outlet/>.
 *   • In modalita desktop (Tauri webview):
 *       1. Risolve il ruolo via `cmd_get_role` (Tauri).
 *       2. Se ruolo == null → mostra `<RoleSelectionView/>` fullscreen (l'utente
 *          sceglie admin/sala UNA volta sola; al riavvio verra' applicato).
 *       3. Se ruolo == 'sala':
 *          • Sprint M2: legge `device.json` via `cmd_get_persisted_device`.
 *          • Se device.json esiste → pre-popola localStorage `device_token` /
 *            `device_id` (compat con `PairView` esistente che fa auto-rejoin
 *            via `localStorage`) e naviga direttamente a `/sala/:token`,
 *            saltando il keypad anche al primo render. Cosi' il PC sala
 *            riavviato a meta' evento riprende a lavorare in < 1s.
 *          • Se device.json NON esiste → naviga a `/pair` (utente fara'
 *            pairing manuale o l'admin lo pairizzera' via "Aggiungi PC LAN").
 *       4. Se ruolo == 'admin' → render normale (default cloud-equivalente).
 *
 * **Regola sovrana 4**: una volta che `device.json` esiste, il PC sala NON
 * deve mai piu' chiedere il pairing finche' qualcuno (utente locale o admin
 * LAN) non chiama `cmd_clear_device_pairing` / `pair-revoke`.
 *
 * Per evitare flash:
 *   • durante il check iniziale viene mostrato un piccolo loader.
 *   • cache in-memory: una volta letto il ruolo lo memorizziamo finche' la
 *     finestra non viene chiusa.
 */
export function DesktopRoleGate() {
  const inTauri = isRunningInTauri();
  const [resolved, setResolved] = useState<NodeRole | null | 'loading'>(
    inTauri ? 'loading' : 'admin',
  );
  // Sprint M2: token risolto da device.json (per redirect diretto a /sala/:token).
  // `undefined` = non ancora controllato; `null` = controllato e nessun token; stringa = token presente.
  const [salaAutoToken, setSalaAutoToken] = useState<string | null | undefined>(
    inTauri ? undefined : null,
  );
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void (async () => {
      const role = await getDesktopRole();
      if (cancelled) return;
      setResolved(role);
      // Solo per role=sala: pre-popola localStorage da device.json. Lo facciamo
      // qui (non nel PairView) cosi' anche un redirect diretto a /sala/:token
      // funziona, e il keypad non lampeggia mai.
      if (role !== 'sala') {
        setSalaAutoToken(null);
        return;
      }
      try {
        const persisted = await getPersistedDevice();
        if (cancelled) return;
        if (persisted) {
          try {
            // Pre-popola localStorage solo se vuoto (rispetta override manuali).
            if (!localStorage.getItem(STORED_TOKEN_KEY)) {
              localStorage.setItem(STORED_TOKEN_KEY, persisted.device_token);
              localStorage.setItem(STORED_DEVICE_ID_KEY, persisted.device_id);
            }
          } catch {
            /* storage potrebbe essere bloccato (privacy mode) — non bloccare */
          }
          setSalaAutoToken(persisted.device_token);
        } else {
          setSalaAutoToken(null);
        }
      } catch {
        if (!cancelled) setSalaAutoToken(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inTauri]);

  // Sprint L1+M2: redirect post-risoluzione.
  useEffect(() => {
    if (!inTauri || resolved !== 'sala') return;
    if (salaAutoToken === undefined) return; // ancora in check device.json
    const isSalaPath =
      location.pathname.startsWith('/sala/') ||
      location.pathname === '/pair' ||
      location.pathname.startsWith('/u/');

    if (salaAutoToken) {
      // Device.json presente → vai dritto alla sala (skip keypad).
      const target = `/sala/${salaAutoToken}`;
      if (location.pathname !== target) {
        navigate(target, { replace: true });
      }
      return;
    }
    // Nessun device.json → mostra PairView (path /pair).
    if (!isSalaPath) {
      navigate('/pair', { replace: true });
    }
  }, [inTauri, resolved, salaAutoToken, location.pathname, navigate]);

  // Sprint M2: il check device.json e' parte del bootstrap del role=sala.
  // Senza questo, c'e' un flash di /pair prima del redirect a /sala/:token.
  if (resolved === 'loading' || (resolved === 'sala' && salaAutoToken === undefined)) {
    return (
      <div className="fixed inset-0 z-100 flex items-center justify-center bg-sc-bg text-sc-text-muted">
        …
      </div>
    );
  }

  if (resolved === null) {
    // Schermata di scelta ruolo (Sprint L1). Dopo la scelta richiede riavvio
    // del processo Tauri per applicare il nuovo ruolo (server + mDNS).
    return <RoleSelectionView onChosen={() => { /* mostra schermata "riavvia" */ }} />;
  }

  return <Outlet />;
}
