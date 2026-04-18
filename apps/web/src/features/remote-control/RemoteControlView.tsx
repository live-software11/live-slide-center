import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import {
  dispatchRemoteCommand,
  getRemoteControlSchedule,
  validateRemoteControlToken,
} from './repository';
import type {
  RemoteControlCommand,
  RemoteControlSchedule,
  RemoteControlValidatedToken,
} from '@slidecenter/shared';

// Sprint T-3-G (G10) — PWA route `/remote/:token`. Telecomando regista via tablet.
//
// Stati possibili:
//   - 'validating': verifica token in corso (spinner full screen)
//   - 'invalid':    token non valido / revocato / scaduto (messaggio finale)
//   - 'ready':      pairing valido, mostra UI telecomando con scaletta + comandi
//
// Comportamento real-time: subscribe a `room:<roomId>` per `room_state_changed`
// e `presentation_changed` -> refetch scaletta. Polling fallback 15s.
//
// Wake-lock: tenta di mantenere lo schermo del tablet acceso (Screen Wake Lock
// API). Best-effort, no errore se non disponibile (Safari iOS).

type ValidationState =
  | { kind: 'validating' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ready'; pairing: RemoteControlValidatedToken };

const POLL_MS = 15_000;

function RemoteControlView() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();

  const [state, setState] = useState<ValidationState>({ kind: 'validating' });
  const [schedule, setSchedule] = useState<RemoteControlSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [busyCommand, setBusyCommand] = useState<RemoteControlCommand | 'goto' | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [realtimeOnline, setRealtimeOnline] = useState(false);

  const wakeLockRef = useRef<unknown>(null);

  // ── 1) Validazione token ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || token.length < 16) {
        if (!cancelled) setState({ kind: 'invalid', reason: 'token_invalid' });
        return;
      }
      try {
        const pairing = await validateRemoteControlToken(token);
        if (!cancelled) setState({ kind: 'ready', pairing });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'token_invalid';
        const reason =
          msg.includes('token_revoked')
            ? 'token_revoked'
            : msg.includes('token_expired')
              ? 'token_expired'
              : 'token_invalid';
        setState({ kind: 'invalid', reason });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ── 2) Wake lock screen (best-effort, ignorato se non supportato) ─────────
  useEffect(() => {
    if (state.kind !== 'ready') return;
    let cancelled = false;
    (async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } })
          .wakeLock;
        if (!wl) return;
        const lock = await wl.request('screen');
        if (cancelled) {
          (lock as { release?: () => Promise<void> }).release?.();
          return;
        }
        wakeLockRef.current = lock;
      } catch {
        // No-op: alcuni browser (Safari iOS) non supportano wakeLock.
      }
    })();
    return () => {
      cancelled = true;
      const lock = wakeLockRef.current as { release?: () => Promise<void> } | null;
      lock?.release?.();
      wakeLockRef.current = null;
    };
  }, [state.kind]);

  // ── 3) Fetch scaletta (anche per refresh manuale) ──────────────────────────
  const fetchSchedule = useCallback(async () => {
    if (!token) return;
    setScheduleLoading(true);
    try {
      const data = await getRemoteControlSchedule(token);
      setSchedule(data);
      setLastError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch_failed';
      setLastError(msg);
    } finally {
      setScheduleLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    void fetchSchedule();
  }, [state.kind, fetchSchedule]);

  // ── 4) Polling fallback ────────────────────────────────────────────────────
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const id = window.setInterval(() => void fetchSchedule(), POLL_MS);
    return () => window.clearInterval(id);
  }, [state.kind, fetchSchedule]);

  // ── 5) Realtime subscribe ──────────────────────────────────────────────────
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const roomId = state.pairing.roomId;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`room:${roomId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'room_state_changed' }, () => void fetchSchedule())
      .on('broadcast', { event: 'presentation_changed' }, () => void fetchSchedule())
      .subscribe((status) => {
        setRealtimeOnline(status === 'SUBSCRIBED');
      });
    return () => {
      void supabase.removeChannel(channel);
      setRealtimeOnline(false);
    };
  }, [state.kind, state, fetchSchedule]);

  // ── 6) Dispatch comando ────────────────────────────────────────────────────
  const dispatch = useCallback(
    async (command: RemoteControlCommand, targetPresentationId?: string) => {
      if (!token) return;
      const busyKey = command === 'goto' ? 'goto' : command;
      setBusyCommand(busyKey);
      setLastError(null);
      try {
        const result = await dispatchRemoteCommand({
          token,
          command,
          targetPresentationId: targetPresentationId ?? null,
        });
        // Optimistic update locale per UX immediata; il broadcast Realtime
        // riconfermera' (o riallineera') a breve.
        setSchedule((prev) =>
          prev ? { ...prev, currentPresentationId: result.presentationId } : prev,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'dispatch_failed';
        setLastError(msg);
        // Rifetch in caso di errore (per riallineare se schedule e' stale).
        void fetchSchedule();
      } finally {
        setBusyCommand(null);
      }
    },
    [token, fetchSchedule],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  if (state.kind === 'validating') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm text-slate-300">{t('remoteControl.validating')}</p>
        </div>
      </div>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-950/40 p-6 text-center">
          <h1 className="text-lg font-semibold text-red-100">
            {t('remoteControl.invalidTitle')}
          </h1>
          <p className="mt-2 text-sm text-red-200/80">
            {t(`remoteControl.reason.${state.reason}`)}
          </p>
          <p className="mt-4 text-xs text-red-200/60">{t('remoteControl.invalidHelp')}</p>
        </div>
      </div>
    );
  }

  const pairing = state.pairing;
  const items = schedule?.schedule ?? [];
  const currentId = schedule?.currentPresentationId ?? null;
  const currentIdx = currentId ? items.findIndex((i) => i.presentationId === currentId) : -1;
  const isAtFirst = currentIdx === 0;
  const isAtLast = currentIdx >= 0 && currentIdx === items.length - 1;
  const isBlank = currentId === null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/70 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold sm:text-lg">
              {pairing.roomName ?? t('remoteControl.untitledRoom')}
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {pairing.eventTitle ? `${pairing.eventTitle} · ` : ''}
              {schedule?.sessionTitle ?? t('remoteControl.noActiveSession')}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span
              className={`inline-flex items-center gap-1 ${realtimeOnline ? 'text-emerald-400' : 'text-amber-400'}`}
              title={realtimeOnline ? t('remoteControl.realtimeOn') : t('remoteControl.realtimeOff')}
            >
              {realtimeOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            </span>
            <button
              type="button"
              onClick={() => void fetchSchedule()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
              aria-label={t('remoteControl.refresh')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scheduleLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-4 sm:flex-row">
        {/* Comandi */}
        <section className="flex flex-col gap-3 sm:w-1/2">
          <CurrentBanner
            schedule={schedule}
            isBlank={isBlank}
            tEmpty={t('remoteControl.noFileLive')}
            tBlankLabel={t('remoteControl.blankLive')}
          />
          <div className="grid grid-cols-2 gap-3">
            <CommandButton
              label={t('remoteControl.cmd.prev')}
              icon={<ChevronLeft className="h-8 w-8" />}
              onClick={() => void dispatch('prev')}
              disabled={
                busyCommand !== null || items.length === 0 || (currentIdx >= 0 && isAtFirst)
              }
              loading={busyCommand === 'prev'}
              variant="neutral"
            />
            <CommandButton
              label={t('remoteControl.cmd.next')}
              icon={<ChevronRight className="h-8 w-8" />}
              onClick={() => void dispatch('next')}
              disabled={
                busyCommand !== null || items.length === 0 || (currentIdx >= 0 && isAtLast)
              }
              loading={busyCommand === 'next'}
              variant="primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CommandButton
              label={
                isBlank ? t('remoteControl.cmd.unblank') : t('remoteControl.cmd.blank')
              }
              icon={isBlank ? <Eye className="h-6 w-6" /> : <EyeOff className="h-6 w-6" />}
              onClick={() => {
                if (isBlank) {
                  // "Unblank" = riapri il primo file della scaletta (semantica
                  // semplice e prevedibile). Per "ripristina ultimo non-null"
                  // serve persistenza extra che oggi non aggiunge valore al
                  // regista.
                  void dispatch('first');
                } else {
                  void dispatch('blank');
                }
              }}
              disabled={busyCommand !== null}
              loading={busyCommand === 'blank' || (isBlank && busyCommand === 'first')}
              variant={isBlank ? 'primary' : 'danger'}
            />
            <CommandButton
              label={t('remoteControl.cmd.first')}
              icon={<RefreshCw className="h-6 w-6" />}
              onClick={() => void dispatch('first')}
              disabled={busyCommand !== null || items.length === 0}
              loading={busyCommand === 'first' && !isBlank}
              variant="neutral"
            />
          </div>
          {lastError && (
            <ErrorBanner message={lastError} t={t} />
          )}
        </section>

        {/* Scaletta */}
        <section className="flex min-h-[12rem] flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/60">
          <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <h2 className="text-sm font-semibold">{t('remoteControl.scheduleTitle')}</h2>
            <span className="text-xs text-slate-400">
              {items.length > 0
                ? t('remoteControl.scheduleCount', { count: items.length })
                : t('remoteControl.scheduleEmpty')}
            </span>
          </header>
          <ul className="flex-1 overflow-auto">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-500">
                {scheduleLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t('remoteControl.scheduleEmptyHelp')}
              </li>
            ) : (
              items.map((item, idx) => {
                const isCurrent = item.presentationId === currentId;
                return (
                  <li key={item.presentationId} className="border-b border-slate-800/60 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => void dispatch('goto', item.presentationId)}
                      disabled={busyCommand !== null || isCurrent}
                      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
                        isCurrent
                          ? 'bg-emerald-500/10 text-emerald-100'
                          : 'hover:bg-slate-800/70 active:bg-slate-700/70 disabled:opacity-50'
                      }`}
                    >
                      <span
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          isCurrent
                            ? 'bg-emerald-500/30 text-emerald-200'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.fileName}</span>
                        {item.speakerName && (
                          <span className="block truncate text-xs text-slate-400">
                            {item.speakerName}
                          </span>
                        )}
                      </span>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                          {t('remoteControl.live')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}

interface CurrentBannerProps {
  schedule: RemoteControlSchedule | null;
  isBlank: boolean;
  tEmpty: string;
  tBlankLabel: string;
}

function CurrentBanner({ schedule, isBlank, tEmpty, tBlankLabel }: CurrentBannerProps) {
  if (isBlank) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-100">
        <p className="text-xs uppercase tracking-wide opacity-70">●</p>
        <p className="mt-0.5 text-base font-semibold">{tBlankLabel}</p>
      </div>
    );
  }
  const current = schedule?.schedule.find(
    (i) => i.presentationId === schedule.currentPresentationId,
  );
  if (!current) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">●</p>
        <p className="mt-0.5 text-base font-semibold text-slate-300">{tEmpty}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-100">
      <p className="text-xs uppercase tracking-wide opacity-70">● Live</p>
      <p className="mt-0.5 truncate text-base font-semibold">{current.fileName}</p>
      {current.speakerName && (
        <p className="mt-0.5 truncate text-xs text-emerald-200/70">{current.speakerName}</p>
      )}
    </div>
  );
}

type CommandButtonVariant = 'primary' | 'neutral' | 'danger';

interface CommandButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: CommandButtonVariant;
}

function CommandButton({
  label,
  icon,
  onClick,
  disabled = false,
  loading = false,
  variant = 'neutral',
}: CommandButtonProps) {
  const cls =
    variant === 'primary'
      ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-100 active:bg-emerald-500/25'
      : variant === 'danger'
        ? 'border-amber-500/60 bg-amber-500/15 text-amber-100 active:bg-amber-500/25'
        : 'border-slate-700 bg-slate-800/70 text-slate-100 active:bg-slate-700/70';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border px-3 py-4 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {loading ? <Loader2 className="h-7 w-7 animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

interface ErrorBannerProps {
  message: string;
  t: (key: string) => string;
}

export default RemoteControlView;
export { RemoteControlView as Component };

function ErrorBanner({ message, t }: ErrorBannerProps) {
  // Codici noti -> chiavi i18n. Fallback su raw message.
  const knownKeys: Record<string, string> = {
    rate_limited: 'remoteControl.error.rate_limited',
    no_active_session: 'remoteControl.error.no_active_session',
    empty_schedule: 'remoteControl.error.empty_schedule',
    end_of_schedule: 'remoteControl.error.end_of_schedule',
    start_of_schedule: 'remoteControl.error.start_of_schedule',
    target_not_ready: 'remoteControl.error.target_not_ready',
    token_expired: 'remoteControl.reason.token_expired',
    token_revoked: 'remoteControl.reason.token_revoked',
  };
  const matchedKey = Object.keys(knownKeys).find((k) => message.includes(k));
  const text = matchedKey ? t(knownKeys[matchedKey]) : message;
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      {text}
    </div>
  );
}
