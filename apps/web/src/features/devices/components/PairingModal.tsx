import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { usePairingFlow, type PairingState } from '../hooks/usePairingFlow';

interface PairingModalProps {
  eventId: string;
  roomId?: string | null;
  onClose: () => void;
  onPaired: (deviceId: string) => void;
}

function useCountdown(expiresAt: Date | null) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function PairingCode({ code }: { code: string }) {
  return (
    <span className="font-mono text-5xl font-bold tracking-[0.25em] text-white">
      {code}
    </span>
  );
}

export function PairingModal({ eventId, roomId, onClose, onPaired }: PairingModalProps) {
  const { t } = useTranslation();
  const { state, startPairing, reset } = usePairingFlow({ eventId, roomId });

  const expiresAt =
    state.status === 'showing_code' || state.status === 'polling'
      ? state.expiresAt
      : null;
  const countdown = useCountdown(expiresAt);

  useEffect(() => {
    void startPairing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.status === 'paired') {
      onPaired(state.deviceId);
    }
  }, [state, onPaired]);

  const pairUrl = `${window.location.origin}/pair`;

  const renderBody = (s: PairingState) => {
    if (s.status === 'idle' || s.status === 'generating') {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-10 w-10 animate-spin text-sc-primary" />
          <p className="text-sm text-sc-text-muted">{t('devices.pairing.generating')}</p>
        </div>
      );
    }

    if (s.status === 'showing_code' || s.status === 'polling') {
      return (
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-sc-text-muted">{t('devices.pairing.openUrl')}</p>
            <span className="rounded bg-sc-elevated px-3 py-1 font-mono text-sm text-sc-text">
              {pairUrl}
            </span>
          </div>

          <div className="rounded-xl bg-white p-3">
            <QRCode value={pairUrl} size={160} />
          </div>

          <div className="flex flex-col items-center gap-1">
            <p className="text-sm text-sc-text-muted">{t('devices.pairing.enterCode')}</p>
            <PairingCode code={s.code} />
            <p className="mt-1 text-xs text-sc-text-dim">
              {t('devices.pairing.expiresIn', { countdown })}
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm text-sc-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('devices.pairing.waitingForDevice')}
          </div>
        </div>
      );
    }

    if (s.status === 'paired') {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <CheckCircle2 className="h-12 w-12 text-sc-success" />
          <p className="text-lg font-semibold text-white">
            {t('devices.pairing.success', { name: s.deviceName })}
          </p>
        </div>
      );
    }

    if (s.status === 'expired') {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <p className="text-sc-text-secondary">{t('devices.pairing.expired')}</p>
          <button
            type="button"
            onClick={() => startPairing()}
            className="inline-flex items-center gap-2 rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80"
          >
            <RefreshCw className="h-4 w-4" />
            {t('devices.pairing.regenerate')}
          </button>
        </div>
      );
    }

    if (s.status === 'error') {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <p className="text-sc-danger">{t('devices.pairing.errorGeneric', { message: s.message })}</p>
          <button
            type="button"
            onClick={() => { reset(); startPairing(); }}
            className="inline-flex items-center gap-2 rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80"
          >
            <RefreshCw className="h-4 w-4" />
            {t('devices.pairing.regenerate')}
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pairing-modal-title"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-sc-surface border border-sc-primary/20 p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl p-1 text-sc-text-muted hover:text-sc-text"
          aria-label={t('common.close')}
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="pairing-modal-title" className="mb-4 text-lg font-semibold text-white">
          {t('devices.pairing.title')}
        </h2>

        {renderBody(state)}
      </div>
    </div>
  );
}
