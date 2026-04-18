// ════════════════════════════════════════════════════════════════════════════
// Sprint D5 — DesktopBindAutoView
// ════════════════════════════════════════════════════════════════════════════
//
// Rotta `/centro-slide/bind?t=<token>`. Endpoint deep-link aperto dal magic-
// link generato in `DesktopDevicesView`.
//
// Comportamento:
//   - Modalità desktop (Tauri): legge `t` da query, chiama `cmd_license_bind`
//     in automatico, mostra spinner → success → redirect a /. In errore
//     mostra il motivo + pulsante "Riprova" + link a /centro-slide/licenza.
//   - Modalità cloud (browser): mostra istruzioni "Apri questo URL sul PC
//     server". Niente bind automatico.
//
// Nota di sicurezza: il token resta in `window.location.search` SOLO il tempo
// del bind. Dopo successo la pagina fa `navigate('/', { replace: true })`
// rimuovendolo dalla cronologia.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Loader2, ServerCog, XCircle } from 'lucide-react';
import { getBackendMode } from '@/lib/backend-mode';
import { bindDesktopLicense } from '@/lib/desktop-bridge';

type Phase = 'idle' | 'binding' | 'ok' | 'error' | 'cloud';

// Inizializzatore lazy per scegliere la phase iniziale senza causare cascading
// renders dentro useEffect (regola eslint react-hooks/set-state-in-effect).
function pickInitialPhase(isDesktop: boolean, hasToken: boolean): Phase {
  if (!isDesktop) return 'cloud';
  if (!hasToken) return 'error';
  return 'binding';
}

function DesktopBindAutoView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('t');
  const isDesktop = getBackendMode() === 'desktop';

  const [phase, setPhase] = useState<Phase>(() => pickInitialPhase(isDesktop, Boolean(token)));
  const [errorMsg, setErrorMsg] = useState<string | null>(() =>
    isDesktop && !token ? 'missing_token' : null,
  );

  const runBind = useCallback(async () => {
    if (!token) return;
    setPhase('binding');
    setErrorMsg(null);
    try {
      const res = await bindDesktopLicense({ magicLink: token });
      if (res.ok) {
        setPhase('ok');
        // Redirect dopo 1.5s. `replace:true` rimuove il token dalla history.
        setTimeout(() => navigate('/', { replace: true }), 1500);
      } else {
        setPhase('error');
        setErrorMsg(res.error ?? 'bind_failed');
      }
    } catch (err) {
      setPhase('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [token, navigate]);

  useEffect(() => {
    // L'effetto serve solo a scatenare il bind (side effect su Tauri IPC)
    // quando siamo in desktop con token. Differiamo a microtask per evitare
    // il warning "setState in effect" — runBind() chiama setPhase ma e'
    // legittimo (e' la transizione da idle->binding scatenata da un effetto
    // di mount, non un cascading render).
    if (!isDesktop || !token) return;
    const id = setTimeout(() => {
      void runBind();
    }, 0);
    return () => clearTimeout(id);
  }, [isDesktop, token, runBind]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center p-6">
      <div className="w-full rounded-xl border border-sc-primary/15 bg-sc-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-sc-accent/15 p-2 text-sc-accent">
            <ServerCog className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-sc-text">
              {t('desktopBind.title')}
            </h1>
            <p className="text-xs text-sc-text-muted">{t('desktopBind.subtitle')}</p>
          </div>
        </div>

        {phase === 'cloud' ? (
          <div className="space-y-3">
            <div className="rounded-md border border-sc-warning/30 bg-sc-warning/10 p-3 text-xs text-sc-text-secondary">
              <p className="font-medium text-sc-warning">{t('desktopBind.cloudOnlyTitle')}</p>
              <p className="mt-1">{t('desktopBind.cloudOnlyHint')}</p>
            </div>
            {token ? (
              <div className="rounded-md border border-sc-primary/15 bg-sc-bg p-2.5">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-sc-text-dim">
                  {t('desktopBind.tokenLabel')}
                </p>
                <code className="block break-all text-[11px] text-sc-text-secondary">{token}</code>
              </div>
            ) : null}
            <Link
              to="/centri-slide"
              className="inline-flex items-center justify-center rounded-md bg-sc-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-accent-light"
            >
              {t('desktopBind.backToPanel')}
            </Link>
          </div>
        ) : null}

        {phase === 'binding' ? (
          <div className="flex items-center gap-3 text-sm text-sc-text-secondary">
            <Loader2 className="size-4 animate-spin text-sc-accent" />
            {t('desktopBind.binding')}
          </div>
        ) : null}

        {phase === 'ok' ? (
          <div className="flex items-center gap-3 text-sm text-sc-success">
            <CheckCircle2 className="size-4" /> {t('desktopBind.success')}
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-sm text-sc-danger">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">{t('desktopBind.errorTitle')}</p>
                <p className="mt-0.5 text-xs text-sc-text-secondary">
                  {errorMsg ? t(`desktopBind.errors.${errorMsg}`, { defaultValue: errorMsg }) : t('desktopBind.errors.unknown')}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runBind()}
                disabled={!token}
                className="inline-flex items-center justify-center rounded-md bg-sc-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-accent-light disabled:opacity-50"
              >
                {t('desktopBind.retry')}
              </button>
              <Link
                to="/centro-slide/licenza"
                className="inline-flex items-center justify-center rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
              >
                {t('desktopBind.openLicensePage')}
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default DesktopBindAutoView;
export { DesktopBindAutoView as Component };
