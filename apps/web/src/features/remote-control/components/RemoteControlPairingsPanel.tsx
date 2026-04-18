import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Loader2, Smartphone, Trash2, X } from 'lucide-react';
import {
  buildRemoteControlUrl,
  createRemoteControlPairing,
  listActiveRemoteControlPairingsForRoom,
  revokeRemoteControlPairing,
} from '../repository';
import type { RemoteControlPairingSummary } from '@slidecenter/shared';

/**
 * Sprint T-3-G (G10) — pannello admin per gestire i telecomandi remoti
 * (PWA `/remote/<token>`) di una sala. Integrato in `EventDetailView`
 * sotto `<RoomDevicesPanel>`.
 *
 * Funzioni:
 *   - Genera nuovo token (nome + TTL) -> mostra URL/token IN CHIARO una volta.
 *   - Lista pairings ATTIVI per la sala (non revocati e non scaduti).
 *   - Revoca pairing (idempotente).
 *
 * Quando l'admin chiude il box "token created" il token NON e' piu' recuperabile.
 */

interface Props {
  roomId: string;
  locale: string;
}

const TTL_OPTIONS: Array<{ value: number; key: string }> = [
  { value: 60, key: 'remoteControl.admin.ttl.1h' },
  { value: 60 * 24, key: 'remoteControl.admin.ttl.24h' },
  { value: 60 * 24 * 7, key: 'remoteControl.admin.ttl.7d' },
];

export function RemoteControlPairingsPanel({ roomId, locale }: Props) {
  const { t } = useTranslation();
  const [pairings, setPairings] = useState<RemoteControlPairingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listActiveRemoteControlPairingsForRoom(roomId);
      setPairings(data);
    } catch {
      // Non bloccante: il pannello e' opzionale.
      setPairings([]);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <div className="mt-3 border-t border-sc-primary/15 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs text-sc-text-dim hover:text-sc-text"
        aria-expanded={open}
      >
        <Smartphone className="h-3.5 w-3.5" aria-hidden />
        {t('remoteControl.admin.title')}
        {pairings.length > 0 && (
          <span className="rounded-full bg-sc-primary/15 px-2 py-0.5 text-[10px] font-semibold text-sc-primary">
            {pairings.length}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-sc-text-dim">{t('remoteControl.admin.intro')}</p>
          <CreatePairingForm roomId={roomId} onCreated={refresh} />
          <PairingList
            pairings={pairings}
            loading={loading}
            locale={locale}
            onRevoke={async (id) => {
              await revokeRemoteControlPairing(id);
              await refresh();
            }}
          />
        </div>
      )}
    </div>
  );
}

interface CreatePairingFormProps {
  roomId: string;
  onCreated: () => Promise<void> | void;
}

function CreatePairingForm({ roomId, onCreated }: CreatePairingFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState<number>(60 * 24);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; url: string; expiresAt: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    if (cleanName.length === 0) {
      setError(t('remoteControl.admin.nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createRemoteControlPairing({ roomId, name: cleanName, ttlMinutes });
      const url = buildRemoteControlUrl(result.token);
      setCreated({ token: result.token, url, expiresAt: result.expiresAt });
      setName('');
      await onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'create_failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  if (created) {
    return (
      <div className="rounded-xl border border-sc-success/40 bg-sc-success/5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-sc-success">
              {t('remoteControl.admin.tokenCreatedTitle')}
            </p>
            <p className="mt-1 text-xs text-sc-text-dim">
              {t('remoteControl.admin.tokenCreatedHelp')}
            </p>
            <div className="mt-2 break-all rounded-md border border-sc-success/30 bg-sc-bg/60 p-2 font-mono text-[11px] text-sc-success">
              {created.url}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded-md border border-sc-success/40 px-2 py-1 text-xs text-sc-success hover:bg-sc-success/10"
              >
                <Copy className="h-3 w-3" />
                {copied ? t('remoteControl.admin.copied') : t('remoteControl.admin.copyUrl')}
              </button>
              <a
                href={created.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-sc-success/40 px-2 py-1 text-xs text-sc-success hover:bg-sc-success/10"
              >
                <ExternalLink className="h-3 w-3" />
                {t('remoteControl.admin.openInNewTab')}
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="text-sc-text-dim hover:text-sc-text"
            aria-label={t('remoteControl.admin.dismiss')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-sc-primary/20 bg-sc-bg/50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="block text-[11px] uppercase tracking-wide text-sc-text-dim">
            {t('remoteControl.admin.namePlaceholder')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1.5 text-sm text-sc-text focus:border-sc-primary/60 focus:outline-none"
            placeholder={t('remoteControl.admin.nameExample')}
            disabled={busy}
            required
          />
        </div>
        <div className="w-32">
          <label className="block text-[11px] uppercase tracking-wide text-sc-text-dim">
            {t('remoteControl.admin.ttlLabel')}
          </label>
          <select
            value={ttlMinutes}
            onChange={(e) => setTtlMinutes(Number(e.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1.5 text-sm text-sc-text focus:border-sc-primary/60 focus:outline-none"
          >
            {TTL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.key)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-sc-primary px-3 py-1.5 text-sm font-medium text-sc-bg hover:bg-sc-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
          {t('remoteControl.admin.create')}
        </button>
      </div>
      {error && <p className="text-xs text-sc-warning">{error}</p>}
    </form>
  );
}

interface PairingListProps {
  pairings: RemoteControlPairingSummary[];
  loading: boolean;
  locale: string;
  onRevoke: (id: string) => Promise<void>;
}

function PairingList({ pairings, loading, locale, onRevoke }: PairingListProps) {
  const { t } = useTranslation();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const fmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  }, [locale]);
  const formatTs = (iso: string | null) => (iso && fmt ? fmt.format(new Date(iso)) : '—');

  if (loading && pairings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-sc-text-dim">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('remoteControl.admin.loading')}
      </div>
    );
  }

  if (pairings.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-sc-primary/20 px-3 py-3 text-center text-xs text-sc-text-dim">
        {t('remoteControl.admin.empty')}
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {pairings.map((p) => (
        <li
          key={p.id}
          className="flex items-center justify-between gap-2 rounded-md border border-sc-primary/15 bg-sc-bg/40 px-3 py-2 text-xs"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sc-text">{p.name}</p>
            <p className="truncate text-sc-text-dim">
              {t('remoteControl.admin.expiresAt', { date: formatTs(p.expiresAt) })}
              {p.lastUsedAt && (
                <>
                  {' · '}
                  {t('remoteControl.admin.lastUsedAt', { date: formatTs(p.lastUsedAt) })}
                </>
              )}
              {' · '}
              {t('remoteControl.admin.commandsCount', { count: p.commandsCount })}
            </p>
          </div>
          {pendingRevokeId === p.id ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={revokingId !== null}
                onClick={async () => {
                  setRevokingId(p.id);
                  try {
                    await onRevoke(p.id);
                  } finally {
                    setRevokingId(null);
                    setPendingRevokeId(null);
                  }
                }}
                className="rounded-md bg-sc-danger/20 px-2 py-1 text-[11px] text-sc-danger hover:bg-sc-danger/30"
              >
                {revokingId === p.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  t('common.confirmDelete')
                )}
              </button>
              <button
                type="button"
                onClick={() => setPendingRevokeId(null)}
                className="rounded-md border border-sc-primary/20 px-2 py-1 text-[11px] text-sc-text-dim hover:bg-sc-elevated"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPendingRevokeId(p.id)}
              className="rounded-md p-1 text-sc-text-dim hover:bg-sc-danger/10 hover:text-sc-danger"
              aria-label={t('remoteControl.admin.revoke')}
              title={t('remoteControl.admin.revoke')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
