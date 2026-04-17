import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EdgeFunctionAuthError,
  EdgeFunctionMissingError,
  invokePairInit,
  invokePairPoll,
  type PairPollResponse,
} from '../repository';

export type PairingErrorKind = 'auth' | 'function_missing' | 'generic';

export type PairingState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'showing_code'; code: string; expiresAt: Date }
  | { status: 'polling'; code: string; expiresAt: Date }
  | { status: 'paired'; deviceId: string; deviceName: string }
  | { status: 'expired' }
  | { status: 'error'; kind: PairingErrorKind; message: string };

interface UsePairingFlowOptions {
  eventId: string;
  roomId?: string | null;
  pollIntervalMs?: number;
}

interface UsePairingFlowReturn {
  state: PairingState;
  startPairing: () => void;
  reset: () => void;
}

export function usePairingFlow({
  eventId,
  roomId,
  pollIntervalMs = 3000,
}: UsePairingFlowOptions): UsePairingFlowReturn {
  const [state, setState] = useState<PairingState>({ status: 'idle' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (expiryRef.current) {
      clearTimeout(expiryRef.current);
      expiryRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (code: string, expiresAt: Date) => {
      setState({ status: 'polling', code, expiresAt });

      pollRef.current = setInterval(async () => {
        try {
          const result: PairPollResponse = await invokePairPoll(code);

          if (result.status === 'consumed' && result.device_id) {
            clearTimers();
            setState({
              status: 'paired',
              deviceId: result.device_id,
              deviceName: result.device_name ?? `PC-${code}`,
            });
          } else if (result.status === 'expired') {
            clearTimers();
            setState({ status: 'expired' });
          }
        } catch {
          // keep polling on transient errors
        }
      }, pollIntervalMs);

      const msToExpiry = expiresAt.getTime() - Date.now();
      expiryRef.current = setTimeout(() => {
        clearTimers();
        setState((prev) =>
          prev.status === 'polling' || prev.status === 'showing_code'
            ? { status: 'expired' }
            : prev,
        );
      }, msToExpiry);
    },
    [clearTimers, pollIntervalMs],
  );

  const startPairing = useCallback(async () => {
    clearTimers();
    setState({ status: 'generating' });

    try {
      const { code, expires_at } = await invokePairInit(eventId, roomId);
      const expiresAt = new Date(expires_at);
      setState({ status: 'showing_code', code, expiresAt });
      startPolling(code, expiresAt);
    } catch (err) {
      const kind: PairingErrorKind =
        err instanceof EdgeFunctionAuthError
          ? 'auth'
          : err instanceof EdgeFunctionMissingError
            ? 'function_missing'
            : 'generic';
      setState({
        status: 'error',
        kind,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [clearTimers, eventId, roomId, startPolling]);

  const reset = useCallback(() => {
    clearTimers();
    setState({ status: 'idle' });
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return { state, startPairing, reset };
}
