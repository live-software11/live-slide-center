import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Delete } from 'lucide-react';
import { invokePairClaim } from './repository';

const DIGITS = 6;

export default function PairView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState<string[]>(Array(DIGITS).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const codeStr = code.join('');
  const isComplete = codeStr.length === DIGITS;

  const handleSubmit = useCallback(async () => {
    if (!isComplete || loading || blocked) return;
    setError(null);
    setLoading(true);

    try {
      const hostname = window.location.hostname;
      const deviceName = `PC-${hostname}`;
      const result = await invokePairClaim(codeStr, deviceName);

      localStorage.setItem('device_token', result.device_token);
      localStorage.setItem('device_id', result.device_id);

      navigate(`/sala/${result.device_token}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      const key =
        msg.includes('invalid') || msg.includes('format')
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

  const appendDigit = useCallback(
    async (digit: string) => {
      setCode((prev) => {
        const idx = prev.findIndex((c) => c === '');
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = digit;
        return next;
      });
    },
    [],
  );

  const deleteDigit = useCallback(() => {
    setCode((prev) => {
      const last = prev.map((c, i) => (c !== '' ? i : -1)).filter((i) => i !== -1).at(-1);
      if (last === undefined) return prev;
      const next = [...prev];
      next[last] = '';
      return next;
    });
  }, []);

  const handleKeypadClick = async (digit: string) => {
    if (blocked || loading) return;
    await appendDigit(digit);
    const newCode = [...code];
    const idx = newCode.findIndex((c) => c === '');
    if (idx !== -1) newCode[idx] = digit;
    if (newCode.filter(Boolean).length === DIGITS) {
      setTimeout(() => void handleSubmit(), 50);
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'del'];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">{t('pair.title')}</h1>
          <p className="mt-2 text-sm text-zinc-400">{t('pair.subtitle')}</p>
        </div>

        <div className="flex justify-center gap-2" aria-label={t('pair.codeInputLabel')}>
          {code.map((digit, i) => (
            <div
              key={i}
              className={`flex h-14 w-10 items-center justify-center rounded-lg border-2 text-2xl font-bold text-white transition-colors ${digit !== ''
                  ? 'border-blue-500 bg-blue-950/40'
                  : 'border-zinc-700 bg-zinc-800'
                }`}
            >
              {digit}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-center text-sm text-red-400" role="alert">
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
                className="flex h-14 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300 active:bg-zinc-700 disabled:opacity-40"
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
                className="flex h-14 items-center justify-center rounded-xl bg-zinc-800 text-xl font-semibold text-white active:bg-zinc-700 disabled:opacity-40"
              >
                {key}
              </button>
            ),
          )}
        </div>

        {loading && (
          <p className="text-center text-sm text-zinc-400">{t('pair.connecting')}</p>
        )}
      </div>
    </div>
  );
}

export { PairView as Component };
