import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Delete, Loader2 } from 'lucide-react';
import { invokePairClaim, invokeRoomPlayerBootstrap } from './repository';
import { isRunningInTauri } from '@/lib/backend-mode';
import { clearDevicePairing, getDesktopRole } from '@/lib/desktop-bridge';

const DIGITS = 6;
const STORED_TOKEN_KEY = 'device_token';
const STORED_DEVICE_ID_KEY = 'device_id';

function defaultDeviceName(): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PC Sala ${suffix}`;
}

export default function PairView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState<string[]>(Array(DIGITS).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // Tentativo silenzioso di riconnessione al boot: se localStorage ha un token
  // valido lato Edge, redirige alla sala. Garantisce auto-rejoin a riavvio PC.
  const [reconnecting, setReconnecting] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(STORED_TOKEN_KEY));
    } catch {
      return false;
    }
  });
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function tryAutoRejoin() {
      let token: string | null = null;
      try {
        token = localStorage.getItem(STORED_TOKEN_KEY);
      } catch {
        token = null;
      }
      if (!token) {
        if (!cancelled) setReconnecting(false);
        return;
      }
      try {
        const data = await invokeRoomPlayerBootstrap(token, false);
        if (cancelled) return;
        if (data.device) {
          navigate(`/sala/${token}`, { replace: true });
          return;
        }
        setReconnecting(false);
      } catch {
        if (cancelled) return;
        // Token invalidato (revocato dall'admin o scaduto): pulisci localStorage
        // cosi' al prossimo render la UI mostra il keypad e l'utente puo' ripairare.
        // Sprint M3: se siamo in modalita desktop role=sala, cancella anche
        // device.json per evitare che `DesktopRoleGate` lo ripopoli al prossimo
        // refresh (loop infinito di redirect a /sala/:token con token revocato).
        try {
          localStorage.removeItem(STORED_TOKEN_KEY);
          localStorage.removeItem(STORED_DEVICE_ID_KEY);
        } catch {
          /* noop */
        }
        if (isRunningInTauri()) {
          try {
            const role = await getDesktopRole();
            if (role === 'sala') {
              await clearDevicePairing();
            }
          } catch {
            /* best-effort: clearDevicePairing e' comunque idempotente */
          }
        }
        if (!cancelled) setReconnecting(false);
      }
    }
    void tryAutoRejoin();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const codeStr = code.join('');
  const isComplete = codeStr.length === DIGITS;

  const handleSubmit = useCallback(async () => {
    if (!isComplete || loading || blocked) return;
    setError(null);
    setLoading(true);

    try {
      const deviceName = defaultDeviceName();
      const result = await invokePairClaim(codeStr, deviceName);

      try {
        localStorage.setItem(STORED_TOKEN_KEY, result.device_token);
        localStorage.setItem(STORED_DEVICE_ID_KEY, result.device_id);
      } catch {
        /* noop: storage potrebbe essere bloccato in modalita' privata */
      }

      navigate(`/sala/${result.device_token}`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      const key = msg.includes('rate_limited')
        ? 'pair.errorRateLimited'
        : msg.includes('invalid') || msg.includes('format')
          ? 'pair.errorInvalid'
          : msg.includes('expired')
            ? 'pair.errorExpired'
            : msg.includes('already')
              ? 'pair.errorUsed'
              : 'pair.errorGeneric';

      setError(t(key));
      setCode(Array(DIGITS).fill(''));
      inputsRef.current[0]?.focus();

      setBlocked(true);
      setTimeout(() => setBlocked(false), 3000);
    } finally {
      setLoading(false);
    }
  }, [blocked, codeStr, isComplete, loading, navigate, t]);

  const pendingSubmitRef = useRef(false);

  const appendDigit = useCallback(
    (digit: string) => {
      setCode((prev) => {
        const idx = prev.findIndex((c) => c === '');
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = digit;
        if (next.every((c) => c !== '')) pendingSubmitRef.current = true;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (pendingSubmitRef.current && isComplete && !loading && !blocked) {
      pendingSubmitRef.current = false;
      void handleSubmit();
    }
  }, [isComplete, loading, blocked, handleSubmit]);

  const deleteDigit = useCallback(() => {
    setCode((prev) => {
      const last = prev.map((c, i) => (c !== '' ? i : -1)).filter((i) => i !== -1).at(-1);
      if (last === undefined) return prev;
      const next = [...prev];
      next[last] = '';
      return next;
    });
  }, []);

  const handleKeypadClick = (digit: string) => {
    if (blocked || loading) return;
    appendDigit(digit);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'del'];

  if (reconnecting) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-sc-primary" aria-hidden="true" />
          <p className="text-sm text-sc-text-muted">{t('pair.reconnecting')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sc-navy ring-1 ring-white/10">
            <span className="text-lg font-bold text-sc-primary">SC</span>
          </div>
          <h1 className="text-2xl font-bold text-sc-text">{t('pair.title')}</h1>
          <p className="mt-2 text-sm text-sc-text-muted">{t('pair.subtitle')}</p>
        </div>

        <div className="flex justify-center gap-2.5" aria-label={t('pair.codeInputLabel')}>
          {code.map((digit, i) => (
            <div
              key={i}
              className={`flex h-14 w-11 items-center justify-center rounded-xl border-2 text-2xl font-bold text-sc-text transition-colors ${
                digit !== ''
                  ? 'border-sc-primary bg-sc-primary/10'
                  : 'border-sc-primary/20 bg-sc-surface'
              }`}
            >
              {digit}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-center text-sm text-sc-danger" role="alert">
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {keys.map((key, i) =>
            key === null ? (
              <div key={i} />
            ) : key === 'del' ? (
              <button
                key="del"
                type="button"
                onClick={deleteDigit}
                disabled={loading || blocked}
                className="flex h-14 items-center justify-center rounded-xl bg-sc-surface text-sc-text-secondary transition-colors active:bg-sc-elevated disabled:opacity-40"
                aria-label={t('pair.delete')}
              >
                <Delete className="h-5 w-5" />
              </button>
            ) : (
              <button
                key={key}
                type="button"
                onClick={() => void handleKeypadClick(key)}
                disabled={loading || blocked || isComplete}
                className="flex h-14 items-center justify-center rounded-xl bg-sc-surface text-xl font-semibold text-sc-text transition-colors active:bg-sc-elevated disabled:opacity-40"
              >
                {key}
              </button>
            ),
          )}
        </div>

        {loading && (
          <p className="text-center text-sm text-sc-text-muted">{t('pair.connecting')}</p>
        )}
      </div>
    </div>
  );
}

export { PairView as Component };
