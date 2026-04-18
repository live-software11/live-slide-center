// ════════════════════════════════════════════════════════════════════════════
// Sprint D5 — DesktopDevicesView (pannello admin "Centri Slide")
// ════════════════════════════════════════════════════════════════════════════
//
// Route /centri-slide. Riservato a tenant admin (RequireTenantAdmin in routes).
//
// 3 sezioni:
//   1. PC desktop server collegati (lista desktop_devices con status,
//      ultimo heartbeat, app version, OS, "Revoca").
//   2. Magic-link attivi per nuovo bind (lista desktop_provision_tokens
//      con scadenza, usi, "Revoca" + bottone "Genera nuovo").
//   3. Ruolo PC sala (paired_devices con toggle room ↔ control_center,
//      RPC update_device_role gia' esistente da Sprint S-4).
//
// Dialog "Genera nuovo": label opzionale, scadenza preset, max usi.
// Dialog "Appena generato": URL plain UNA volta sola + QR + stampa.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import {
  CalendarClock,
  Check,
  Copy,
  Download,
  Loader2,
  Monitor,
  Power,
  Printer,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useNowMs } from '@/lib/use-now-ms';
import {
  classifyDesktopTokenExpiry,
  createDesktopProvisionToken,
  extendDesktopDeviceToken,
  listDesktopDevices,
  listDesktopProvisionTokens,
  listPairedDevicesWithRole,
  revokeDesktopDevice,
  revokeDesktopProvisionToken,
  updatePairedDeviceRole,
  type CreatedDesktopProvisionToken,
  type DesktopDevice,
  type DesktopProvisionToken,
  type PairedDeviceLite,
} from './repository';

type ExpiresPreset = '1h' | '24h' | '7d' | '30d';

const PRESET_MINUTES: Record<ExpiresPreset, number> = {
  '1h': 60,
  '24h': 1440,
  '7d': 7 * 1440,
  '30d': 30 * 1440,
};

function DesktopDevicesView() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'it';

  // ── State: dati delle 3 sezioni ──────────────────────────────────────────
  const [devices, setDevices] = useState<DesktopDevice[]>([]);
  const [tokens, setTokens] = useState<DesktopProvisionToken[]>([]);
  const [pairedDevices, setPairedDevices] = useState<PairedDeviceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── State: dialog "Genera nuovo magic-link" ──────────────────────────────
  const [genOpen, setGenOpen] = useState(false);
  const [genLabel, setGenLabel] = useState('');
  const [genExpires, setGenExpires] = useState<ExpiresPreset>('24h');
  const [genMaxUses, setGenMaxUses] = useState<number>(1);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // ── State: dialog "Appena generato" (mostra URL plain) ───────────────────
  const [created, setCreated] = useState<CreatedDesktopProvisionToken | null>(null);
  const [copied, setCopied] = useState(false);

  // ── State: action in flight per evitare double-click ─────────────────────
  const [revokingDevice, setRevokingDevice] = useState<Record<string, boolean>>({});
  const [revokingToken, setRevokingToken] = useState<Record<string, boolean>>({});
  const [updatingRole, setUpdatingRole] = useState<Record<string, boolean>>({});
  const [extendingToken, setExtendingToken] = useState<Record<string, boolean>>({});

  const nowMs = useNowMs(60_000);

  // ── Reload globale (3 query in parallelo) ────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [d, tk, pd] = await Promise.all([
        listDesktopDevices(),
        listDesktopProvisionTokens(),
        listPairedDevicesWithRole(),
      ]);
      setDevices(d);
      setTokens(tk);
      setPairedDevices(pd);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [d, tk, pd] = await Promise.all([
          listDesktopDevices(),
          listDesktopProvisionTokens(),
          listPairedDevicesWithRole(),
        ]);
        if (cancelled) return;
        setDevices(d);
        setTokens(tk);
        setPairedDevices(pd);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const submitCreate = useCallback(async () => {
    setGenBusy(true);
    setGenError(null);
    try {
      const res = await createDesktopProvisionToken({
        label: genLabel.trim() || null,
        expiresMinutes: PRESET_MINUTES[genExpires],
        maxUses: genMaxUses,
      });
      setCreated(res);
      setGenOpen(false);
      setGenLabel('');
      void reload();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenBusy(false);
    }
  }, [genLabel, genExpires, genMaxUses, reload]);

  const submitRevokeDevice = useCallback(
    async (deviceId: string) => {
      if (!window.confirm(t('desktopDevices.devices.revokeConfirm'))) return;
      setRevokingDevice((m) => ({ ...m, [deviceId]: true }));
      try {
        await revokeDesktopDevice(deviceId);
        void reload();
      } catch (err) {
        window.alert(`${t('common.error')}: ${err instanceof Error ? err.message : err}`);
      } finally {
        setRevokingDevice((m) => {
          const next = { ...m };
          delete next[deviceId];
          return next;
        });
      }
    },
    [reload, t],
  );

  const submitExtendToken = useCallback(
    async (deviceId: string, deviceName: string, extraMonths: number) => {
      if (
        !window.confirm(
          t('desktopDevices.devices.extendConfirm', { name: deviceName, months: extraMonths }),
        )
      ) {
        return;
      }
      setExtendingToken((m) => ({ ...m, [deviceId]: true }));
      try {
        const res = await extendDesktopDeviceToken({ deviceId, extraMonths });
        const newExp = new Date(res.pair_token_expires_at).toLocaleDateString(locale);
        window.alert(
          t('desktopDevices.devices.extendSuccess', {
            name: deviceName,
            until: newExp,
            days: res.pair_token_expires_in_days,
          }),
        );
        void reload();
      } catch (err) {
        window.alert(`${t('common.error')}: ${err instanceof Error ? err.message : err}`);
      } finally {
        setExtendingToken((m) => {
          const next = { ...m };
          delete next[deviceId];
          return next;
        });
      }
    },
    [locale, reload, t],
  );

  const submitRevokeToken = useCallback(
    async (tokenId: string) => {
      if (!window.confirm(t('desktopDevices.tokens.revokeConfirm'))) return;
      setRevokingToken((m) => ({ ...m, [tokenId]: true }));
      try {
        await revokeDesktopProvisionToken(tokenId);
        void reload();
      } catch (err) {
        window.alert(`${t('common.error')}: ${err instanceof Error ? err.message : err}`);
      } finally {
        setRevokingToken((m) => {
          const next = { ...m };
          delete next[tokenId];
          return next;
        });
      }
    },
    [reload, t],
  );

  const submitToggleRole = useCallback(
    async (device: PairedDeviceLite) => {
      const newRole: 'room' | 'control_center' =
        device.role === 'control_center' ? 'room' : 'control_center';
      const confirmKey =
        newRole === 'control_center'
          ? 'desktopDevices.role.promoteConfirm'
          : 'desktopDevices.role.demoteConfirm';
      if (!window.confirm(t(confirmKey, { name: device.device_name }))) return;
      setUpdatingRole((m) => ({ ...m, [device.id]: true }));
      try {
        await updatePairedDeviceRole({ deviceId: device.id, newRole });
        void reload();
      } catch (err) {
        window.alert(`${t('common.error')}: ${err instanceof Error ? err.message : err}`);
      } finally {
        setUpdatingRole((m) => {
          const next = { ...m };
          delete next[device.id];
          return next;
        });
      }
    },
    [reload, t],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-sc-text">
            <Server className="h-5 w-5 text-sc-accent" aria-hidden />
            {t('desktopDevices.title')}
          </h1>
          <p className="mt-1 text-sm text-sc-text-muted">{t('desktopDevices.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 bg-sc-bg px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10 disabled:opacity-50"
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setGenOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-sc-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-accent-light"
          >
            <Sparkles className="size-3.5" /> {t('desktopDevices.tokens.generateBtn')}
          </button>
        </div>
      </header>

      {loadError ? (
        <div className="rounded-md border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger">
          {loadError}
        </div>
      ) : null}

      {/* ── Sezione 1: PC desktop collegati ─────────────────────────────── */}
      <section className="rounded-xl border border-sc-primary/12 bg-sc-surface/40 p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-sc-text">
            <ShieldCheck className="size-4 text-sc-accent" aria-hidden />
            {t('desktopDevices.devices.title')}
            <span className="rounded-full bg-sc-primary/10 px-2 py-0.5 text-[10px] font-semibold text-sc-text-muted">
              {devices.length}
            </span>
          </h2>
        </div>
        <p className="mb-3 text-xs text-sc-text-muted">{t('desktopDevices.devices.subtitle')}</p>
        {loading && devices.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-sc-text-muted">
            <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
          </div>
        ) : devices.length === 0 ? (
          <p className="text-xs italic text-sc-text-muted">{t('desktopDevices.devices.empty')}</p>
        ) : (
          <ul className="divide-y divide-sc-primary/10">
            {devices.map((d) => (
              <DesktopDeviceRow
                key={d.id}
                device={d}
                locale={locale}
                nowMs={nowMs}
                revoking={Boolean(revokingDevice[d.id])}
                extending={Boolean(extendingToken[d.id])}
                onRevoke={() => void submitRevokeDevice(d.id)}
                onExtendToken={(extraMonths) =>
                  void submitExtendToken(d.id, d.device_name, extraMonths)
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Sezione 2: Magic-link attivi ────────────────────────────────── */}
      <section className="rounded-xl border border-sc-primary/12 bg-sc-surface/40 p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-sc-text">
            <Sparkles className="size-4 text-sc-accent" aria-hidden />
            {t('desktopDevices.tokens.title')}
            <span className="rounded-full bg-sc-primary/10 px-2 py-0.5 text-[10px] font-semibold text-sc-text-muted">
              {tokens.length}
            </span>
          </h2>
        </div>
        <p className="mb-3 text-xs text-sc-text-muted">{t('desktopDevices.tokens.subtitle')}</p>
        {tokens.length === 0 ? (
          <p className="text-xs italic text-sc-text-muted">{t('desktopDevices.tokens.empty')}</p>
        ) : (
          <ul className="divide-y divide-sc-primary/10">
            {tokens.map((tk) => (
              <DesktopProvisionTokenRow
                key={tk.id}
                token={tk}
                locale={locale}
                nowMs={nowMs}
                revoking={Boolean(revokingToken[tk.id])}
                onRevoke={() => void submitRevokeToken(tk.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Sezione 3: Ruolo PC sala (room ↔ control_center) ───────────── */}
      <section className="rounded-xl border border-sc-primary/12 bg-sc-surface/40 p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-sc-text">
            <Monitor className="size-4 text-sc-accent" aria-hidden />
            {t('desktopDevices.role.title')}
            <span className="rounded-full bg-sc-primary/10 px-2 py-0.5 text-[10px] font-semibold text-sc-text-muted">
              {pairedDevices.length}
            </span>
          </h2>
        </div>
        <p className="mb-3 text-xs text-sc-text-muted">{t('desktopDevices.role.subtitle')}</p>
        {pairedDevices.length === 0 ? (
          <p className="text-xs italic text-sc-text-muted">{t('desktopDevices.role.empty')}</p>
        ) : (
          <ul className="divide-y divide-sc-primary/10">
            {pairedDevices.map((d) => (
              <PairedDeviceRoleRow
                key={d.id}
                device={d}
                updating={Boolean(updatingRole[d.id])}
                onToggle={() => void submitToggleRole(d)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      {genOpen ? (
        <DialogShell
          title={t('desktopDevices.tokens.generateBtn')}
          onClose={() => (genBusy ? null : setGenOpen(false))}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-sc-text-secondary">
                {t('desktopDevices.tokens.labelLabel')}
              </label>
              <input
                type="text"
                value={genLabel}
                onChange={(e) => setGenLabel(e.target.value.slice(0, 80))}
                placeholder={t('desktopDevices.tokens.labelPlaceholder')}
                className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2.5 py-1.5 text-sm text-sc-text placeholder:text-sc-text-dim focus:outline-none focus:ring-2 focus:ring-sc-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-sc-text-secondary">
                {t('desktopDevices.tokens.expiresLabel')}
              </label>
              <select
                value={genExpires}
                onChange={(e) => setGenExpires(e.target.value as ExpiresPreset)}
                className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2.5 py-1.5 text-sm text-sc-text"
              >
                <option value="1h">{t('desktopDevices.tokens.expires1h')}</option>
                <option value="24h">{t('desktopDevices.tokens.expires24h')}</option>
                <option value="7d">{t('desktopDevices.tokens.expires7d')}</option>
                <option value="30d">{t('desktopDevices.tokens.expires30d')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sc-text-secondary">
                {t('desktopDevices.tokens.maxUsesLabel')}
              </label>
              <select
                value={genMaxUses}
                onChange={(e) => setGenMaxUses(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2.5 py-1.5 text-sm text-sc-text"
              >
                <option value="1">{t('desktopDevices.tokens.maxUses1')}</option>
                <option value="3">{t('desktopDevices.tokens.maxUsesN', { count: 3 })}</option>
                <option value="5">{t('desktopDevices.tokens.maxUsesN', { count: 5 })}</option>
                <option value="10">{t('desktopDevices.tokens.maxUsesN', { count: 10 })}</option>
              </select>
            </div>
            {genError ? <p className="text-xs text-sc-danger">{genError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={genBusy}
                onClick={() => setGenOpen(false)}
                className="rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={genBusy}
                onClick={() => void submitCreate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-sc-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-accent-light disabled:opacity-50"
              >
                {genBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('desktopDevices.tokens.generateBtn')}
              </button>
            </div>
          </div>
        </DialogShell>
      ) : null}

      {created ? (
        <DialogShell
          title={t('desktopDevices.tokens.successTitle')}
          onClose={() => {
            setCreated(null);
            setCopied(false);
          }}
          wide
        >
          <CreatedDesktopTokenView
            created={created}
            locale={locale}
            copied={copied}
            onCopied={() => setCopied(true)}
          />
        </DialogShell>
      ) : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-componenti
// ════════════════════════════════════════════════════════════════════════════

function DesktopDeviceRow({
  device,
  locale,
  nowMs,
  revoking,
  extending,
  onRevoke,
  onExtendToken,
}: {
  device: DesktopDevice;
  locale: string;
  nowMs: number;
  revoking: boolean;
  extending: boolean;
  onRevoke: () => void;
  onExtendToken: (extraMonths: number) => void;
}) {
  const { t } = useTranslation();

  const lastSeenFmt = useMemo(() => {
    if (!device.last_seen_at) return t('desktopDevices.devices.neverSeen');
    const diffSec = Math.max(0, Math.floor((nowMs - new Date(device.last_seen_at).getTime()) / 1000));
    if (diffSec < 60) return t('desktopDevices.devices.lastSeenJustNow');
    if (diffSec < 3600) return t('desktopDevices.devices.lastSeenMinutes', { n: Math.floor(diffSec / 60) });
    if (diffSec < 86400) return t('desktopDevices.devices.lastSeenHours', { n: Math.floor(diffSec / 3600) });
    return t('desktopDevices.devices.lastSeenDays', { n: Math.floor(diffSec / 86400) });
  }, [device.last_seen_at, nowMs, t]);

  const registeredFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(device.registered_at),
      ),
    [device.registered_at, locale],
  );

  const tokenExpiryFmt = useMemo(
    () =>
      device.pair_token_expires_at
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(
          new Date(device.pair_token_expires_at),
        )
        : '',
    [device.pair_token_expires_at, locale],
  );

  const tokenStatus = useMemo(
    () => classifyDesktopTokenExpiry(device, nowMs),
    [device, nowMs],
  );

  const tokenDaysLeft = useMemo(() => {
    if (!device.pair_token_expires_at) return null;
    const ms = new Date(device.pair_token_expires_at).getTime() - nowMs;
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }, [device.pair_token_expires_at, nowMs]);

  const isOnline = useMemo(() => {
    if (device.status !== 'active') return false;
    if (!device.last_seen_at) return false;
    const diffSec = (nowMs - new Date(device.last_seen_at).getTime()) / 1000;
    return diffSec < 86400 * 2; // entro 48h consideriamo "vivo"
  }, [device.status, device.last_seen_at, nowMs]);

  const badgeClass =
    device.status === 'revoked'
      ? 'bg-sc-text-dim/15 text-sc-text-muted'
      : isOnline
        ? 'bg-sc-success/15 text-sc-success'
        : 'bg-sc-warning/15 text-sc-warning';
  const badgeLabel =
    device.status === 'revoked'
      ? t('desktopDevices.devices.statusRevoked')
      : isOnline
        ? t('desktopDevices.devices.statusOnline')
        : t('desktopDevices.devices.statusOffline');

  const tokenBadgeClass =
    tokenStatus === 'expired'
      ? 'bg-sc-danger/15 text-sc-danger'
      : tokenStatus === 'expiring_soon'
        ? 'bg-sc-warning/15 text-sc-warning'
        : 'bg-sc-primary/10 text-sc-text-muted';
  const tokenBadgeLabel =
    tokenStatus === 'expired'
      ? t('desktopDevices.devices.tokenExpiredBadge')
      : tokenStatus === 'expiring_soon'
        ? t('desktopDevices.devices.tokenExpiringBadge', { days: Math.max(0, tokenDaysLeft ?? 0) })
        : t('desktopDevices.devices.tokenOkBadge');

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badgeClass}`}>
            {badgeLabel}
          </span>
          <span className="truncate text-sm font-medium text-sc-text">{device.device_name}</span>
          {device.status === 'active' && tokenStatus !== 'na' ? (
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tokenBadgeClass}`}
              title={t('desktopDevices.devices.tokenExpiryTooltip', { when: tokenExpiryFmt })}
            >
              <CalendarClock className="size-3" aria-hidden />
              {tokenBadgeLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-sc-text-dim">
          <span>{t('desktopDevices.devices.lastSeen', { when: lastSeenFmt })}</span>
          <span>{t('desktopDevices.devices.registered', { when: registeredFmt })}</span>
          {device.status === 'active' && tokenExpiryFmt ? (
            <span>{t('desktopDevices.devices.tokenExpiresAt', { when: tokenExpiryFmt })}</span>
          ) : null}
          {device.app_version ? (
            <span>{t('desktopDevices.devices.appVersion', { v: device.app_version })}</span>
          ) : null}
          {device.os_version ? (
            <span>{t('desktopDevices.devices.osVersion', { v: device.os_version })}</span>
          ) : null}
        </div>
      </div>
      {device.status === 'active' ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={extending}
            onClick={() => onExtendToken(12)}
            aria-label={t('desktopDevices.devices.extendBtnAria')}
            title={t('desktopDevices.devices.extendBtnTitle')}
            className="inline-flex items-center gap-1 rounded-md border border-sc-primary/20 px-2 py-1 text-[11px] font-medium text-sc-text hover:bg-sc-accent/10 hover:text-sc-accent disabled:opacity-50"
          >
            {extending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CalendarClock className="size-3" />
            )}
            {t('desktopDevices.devices.extendBtnLabel')}
          </button>
          <button
            type="button"
            disabled={revoking}
            onClick={onRevoke}
            aria-label={t('desktopDevices.devices.revokeBtn')}
            title={t('desktopDevices.devices.revokeBtn')}
            className="rounded-md p-1.5 text-sc-text-muted hover:bg-sc-danger/10 hover:text-sc-danger disabled:opacity-50"
          >
            {revoking ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function DesktopProvisionTokenRow({
  token,
  locale,
  nowMs,
  revoking,
  onRevoke,
}: {
  token: DesktopProvisionToken;
  locale: string;
  nowMs: number;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();

  const status = useMemo(() => {
    if (token.revoked_at) return 'revoked' as const;
    if (token.consumed_count >= token.max_uses) return 'exhausted' as const;
    if (new Date(token.expires_at).getTime() <= nowMs) return 'expired' as const;
    return 'active' as const;
  }, [token, nowMs]);

  const expiresFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(token.expires_at),
      ),
    [token.expires_at, locale],
  );

  const badgeClass =
    status === 'active'
      ? 'bg-sc-success/15 text-sc-success'
      : status === 'exhausted'
        ? 'bg-sc-warning/15 text-sc-warning'
        : 'bg-sc-text-dim/15 text-sc-text-muted';
  const badgeLabel =
    status === 'active'
      ? t('desktopDevices.tokens.activeBadge')
      : status === 'exhausted'
        ? t('desktopDevices.tokens.exhaustedBadge')
        : status === 'expired'
          ? t('desktopDevices.tokens.expiredBadge')
          : t('desktopDevices.tokens.revokedBadge');

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badgeClass}`}>
            {badgeLabel}
          </span>
          <span className="truncate text-sm text-sc-text">
            {token.label || t('desktopDevices.tokens.untitledLabel')}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-sc-text-dim">
          <span>{t('desktopDevices.tokens.expiresAt', { when: expiresFmt })}</span>
          <span>{t('desktopDevices.tokens.usesCount', { used: token.consumed_count, max: token.max_uses })}</span>
        </div>
      </div>
      {status === 'active' ? (
        <button
          type="button"
          disabled={revoking}
          onClick={onRevoke}
          aria-label={t('desktopDevices.tokens.revokeBtn')}
          title={t('desktopDevices.tokens.revokeBtn')}
          className="shrink-0 rounded-md p-1.5 text-sc-text-muted hover:bg-sc-danger/10 hover:text-sc-danger disabled:opacity-50"
        >
          {revoking ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      ) : null}
    </li>
  );
}

function PairedDeviceRoleRow({
  device,
  updating,
  onToggle,
}: {
  device: PairedDeviceLite;
  updating: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const isCenter = device.role === 'control_center';
  const badgeClass = isCenter
    ? 'bg-sc-accent/15 text-sc-accent'
    : 'bg-sc-primary/15 text-sc-text-muted';
  const badgeLabel = isCenter
    ? t('desktopDevices.role.controlCenter')
    : t('desktopDevices.role.room');
  const ctaLabel = isCenter
    ? t('desktopDevices.role.demoteBtn')
    : t('desktopDevices.role.promoteBtn');

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badgeClass}`}>
            {badgeLabel}
          </span>
          <span className="truncate text-sm font-medium text-sc-text">{device.device_name}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-sc-text-dim">
          {isCenter ? (
            <span>{t('desktopDevices.role.centerHint')}</span>
          ) : (
            <span>{t('desktopDevices.role.roomHint')}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={updating}
        onClick={onToggle}
        className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${isCenter
            ? 'border-sc-text-dim/30 text-sc-text-secondary hover:bg-sc-primary/10'
            : 'border-sc-accent/40 text-sc-accent hover:bg-sc-accent/10'
          }`}
      >
        {updating ? <Loader2 className="inline size-3 animate-spin" /> : ctaLabel}
      </button>
    </li>
  );
}

function CreatedDesktopTokenView({
  created,
  locale,
  copied,
  onCopied,
}: {
  created: CreatedDesktopProvisionToken;
  locale: string;
  copied: boolean;
  onCopied: () => void;
}) {
  const { t } = useTranslation();
  const qrWrapperRef = useRef<HTMLDivElement>(null);

  // Magic-link URL: il PC desktop apre questo URL in browser embedded del bind
  // OPPURE l'admin lo incolla manualmente in DesktopLicenseView. La rotta
  // `/centro-slide/bind?t=...` non esiste come pagina cloud (l'app desktop
  // intercetta il deep-link). Per UX usiamo la stessa origin corrente.
  const url = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.liveslidecenter.com';
    return `${origin}/centro-slide/bind?t=${encodeURIComponent(created.token)}`;
  }, [created.token]);

  const expiresFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(created.expires_at),
      ),
    [created.expires_at, locale],
  );

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(url).then(onCopied);
  }, [url, onCopied]);

  const onCopyTokenOnly = useCallback(() => {
    void navigator.clipboard.writeText(created.token).then(onCopied);
  }, [created.token, onCopied]);

  const onPrint = useCallback(() => {
    const svgEl = qrWrapperRef.current?.querySelector('svg');
    let qrSvgInline = '';
    if (svgEl) {
      const cloned = svgEl.cloneNode(true) as SVGSVGElement;
      cloned.setAttribute('width', '320');
      cloned.setAttribute('height', '320');
      cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      qrSvgInline = cloned.outerHTML;
    }
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    const safeUrl = escapeHtml(url);
    const safeExp = escapeHtml(expiresFmt);
    w.document.write(`<!doctype html>
<html><head><title>Magic Link Centro Slide</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 32px; color: #111; max-width: 540px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #444; font-size: 14px; margin: 4px 0; }
  .qr { display: flex; justify-content: center; padding: 24px 0; }
  .qr svg { width: 320px; height: 320px; }
  code { display: block; word-break: break-all; background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 13px; }
  .footer { color: #888; font-size: 11px; margin-top: 20px; }
  @media print { body { padding: 16px; } }
</style></head>
<body>
  <h1>Magic Link Centro Slide</h1>
  <p>Apri Live SLIDE CENTER Desktop sul PC server, vai in "Licenza" e incolla l'URL sotto. Il PC verrà collegato automaticamente al cloud.</p>
  <div class="qr">${qrSvgInline || '<p style="color:#888">QR non disponibile, usa l&#39;URL sotto.</p>'}</div>
  <p><strong>URL:</strong></p>
  <code>${safeUrl}</code>
  <p class="footer">Scade: ${safeExp} · Max usi: ${created.max_uses}</p>
  <script>setTimeout(function(){ window.print(); }, 50);</script>
</body></html>`);
    w.document.close();
  }, [url, expiresFmt, created.max_uses]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-sc-text-muted">
        {t('desktopDevices.tokens.successDesc', { when: expiresFmt })}
      </p>
      <div ref={qrWrapperRef} className="flex justify-center rounded-lg bg-white p-6">
        <QRCodeSVG value={url} size={224} level="M" includeMargin={false} />
      </div>
      <div className="rounded-md border border-sc-primary/15 bg-sc-bg p-2.5">
        <code className="block break-all text-[11px] text-sc-text-secondary">{url}</code>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
        >
          {copied ? <Check className="size-3.5 text-sc-success" /> : <Copy className="size-3.5" />}
          {copied ? t('desktopDevices.tokens.copyUrlDone') : t('desktopDevices.tokens.copyUrl')}
        </button>
        <button
          type="button"
          onClick={onCopyTokenOnly}
          className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
        >
          <Download className="size-3.5" />
          {t('desktopDevices.tokens.copyTokenOnly')}
        </button>
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
        >
          <Printer className="size-3.5" /> {t('desktopDevices.tokens.printQr')}
        </button>
      </div>
      <div className="rounded-md border border-sc-warning/30 bg-sc-warning/5 p-3 text-[11px] text-sc-text-secondary">
        <p className="font-medium text-sc-warning">{t('desktopDevices.tokens.instructionsTitle')}</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>{t('desktopDevices.tokens.instructions1')}</li>
          <li>{t('desktopDevices.tokens.instructions2')}</li>
          <li>{t('desktopDevices.tokens.instructions3')}</li>
        </ol>
      </div>
    </div>
  );
}

function DialogShell({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'} rounded-xl border border-sc-primary/20 bg-sc-surface p-5 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-sc-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="rounded-md p-1 text-sc-text-muted hover:bg-sc-primary/10"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default DesktopDevicesView;
export { DesktopDevicesView as Component };
