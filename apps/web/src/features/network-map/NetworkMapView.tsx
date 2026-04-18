// ════════════════════════════════════════════════════════════════════════════
// Sprint Z (post-field-test) Gap A + Gap B — NetworkMapView
// ════════════════════════════════════════════════════════════════════════════
//
// Vista admin "Mappa rete tenant": tutti i PC node del tenant (PC sala paired
// + PC desktop server) con stato online/degraded/offline. Filtri per evento,
// tipo, stato, search. Azione "Sposta su evento" per i PC sala (Gap B).
//
// Riferimento: docs/AUDIT_FINALE_E_PIANO_TEST_v1.md §3.3 Gap A, §3.4 Gap B.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  ChevronRight,
  Loader2,
  Monitor,
  Network,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';
import { useNowMs } from '@/lib/use-now-ms';
import { toast } from '@slidecenter/ui';
import {
  listEventsForMove,
  listRoomsForEvent,
  moveDeviceToEvent,
  type EventLite,
  type NetworkNode,
  type NetworkNodeKind,
  type NetworkNodeStatus,
  type RoomLite,
} from './repository';
import { useNetworkMap } from './useNetworkMap';

const STATUS_META: Record<
  NetworkNodeStatus,
  { dot: string; chip: string; label: string }
> = {
  online: {
    dot: 'bg-emerald-500',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    label: 'networkMap.summary.online',
  },
  degraded: {
    dot: 'bg-amber-400',
    chip: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    label: 'networkMap.summary.degraded',
  },
  offline: {
    dot: 'bg-zinc-500',
    chip: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
    label: 'networkMap.summary.offline',
  },
};

type StatusFilter = 'all' | NetworkNodeStatus;
type KindFilter = 'all' | NetworkNodeKind;

function NetworkMapView() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language || 'it';
  const nowMs = useNowMs(15_000);

  const { nodes, eventNames, roomNames, loading, error, refresh } = useNetworkMap();

  // ── Filtri ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const eventOptions = useMemo(() => {
    // Lista eventi distinti presenti nei nodi correnti: evita di mostrare
    // eventi senza alcun PC paired. I nomi vengono dal lookup batch
    // `eventNames` (best-effort): fallback all'UUID se il nome non e' ancora
    // arrivato (es. tenant con eventi cancellati).
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    nodes.forEach((n) => {
      if (n.event_id && !seen.has(n.event_id)) {
        seen.add(n.event_id);
        out.push({ id: n.event_id, name: eventNames.get(n.event_id) ?? n.event_id });
      }
    });
    return out;
  }, [nodes, eventNames]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes.filter((n) => {
      if (eventFilter !== 'all' && n.event_id !== eventFilter) return false;
      if (kindFilter !== 'all' && n.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && n.derived_status !== statusFilter) return false;
      if (q && !n.display_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nodes, search, eventFilter, kindFilter, statusFilter]);

  const summary = useMemo(() => {
    const s = { total: nodes.length, online: 0, degraded: 0, offline: 0 };
    nodes.forEach((n) => {
      if (n.derived_status === 'online') s.online += 1;
      else if (n.derived_status === 'degraded') s.degraded += 1;
      else s.offline += 1;
    });
    return s;
  }, [nodes]);

  // ── Move dialog ──────────────────────────────────────────────────────────
  const [moveTarget, setMoveTarget] = useState<NetworkNode | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-sc-text">
            <Network className="h-5 w-5 text-sc-accent" aria-hidden />
            {t('networkMap.title')}
          </h1>
          <p className="mt-1 text-sm text-sc-text-muted">{t('networkMap.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 bg-sc-bg px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10 disabled:opacity-50"
            aria-label={t('networkMap.actions.refresh')}
            title={t('networkMap.actions.refresh')}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('networkMap.actions.refresh')}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/centri-slide')}
            className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 bg-sc-bg px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
          >
            <Server className="size-3.5" />
            <span>{t('networkMap.actions.openCenters')}</span>
            <ChevronRight className="size-3.5 opacity-60" />
          </button>
        </div>
      </header>

      {/* Errore lettura */}
      {error ? (
        <div className="rounded-md border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger">
          {t('networkMap.errors.loadFailed', { message: error })}
        </div>
      ) : null}

      {/* Summary cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label={t('networkMap.summary.total')} value={summary.total} accent="primary" />
        <SummaryCard label={t('networkMap.summary.online')} value={summary.online} accent="green" />
        <SummaryCard
          label={t('networkMap.summary.degraded')}
          value={summary.degraded}
          accent="amber"
        />
        <SummaryCard
          label={t('networkMap.summary.offline')}
          value={summary.offline}
          accent="zinc"
        />
      </section>

      {/* Filtri */}
      <section className="rounded-xl border border-sc-primary/12 bg-sc-surface/40 p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sc-text-muted"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('networkMap.filters.search')}
              className="w-full rounded-md border border-sc-primary/20 bg-sc-bg py-1.5 pl-7 pr-2 text-xs text-sc-text placeholder:text-sc-text-muted/70 focus:border-sc-accent focus:outline-none"
            />
          </label>
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1.5 text-xs text-sc-text focus:border-sc-accent focus:outline-none"
          >
            <option value="all">{t('networkMap.filters.allEvents')}</option>
            {eventOptions.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            className="rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1.5 text-xs text-sc-text focus:border-sc-accent focus:outline-none"
          >
            <option value="all">{t('networkMap.filters.allKinds')}</option>
            <option value="paired_device">{t('networkMap.filters.kindPaired')}</option>
            <option value="desktop_device">{t('networkMap.filters.kindDesktop')}</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1.5 text-xs text-sc-text focus:border-sc-accent focus:outline-none"
          >
            <option value="all">{t('networkMap.filters.allStatuses')}</option>
            <option value="online">{t('networkMap.filters.statusOnline')}</option>
            <option value="degraded">{t('networkMap.filters.statusDegraded')}</option>
            <option value="offline">{t('networkMap.filters.statusOffline')}</option>
          </select>
        </div>
      </section>

      {/* Tabella nodi */}
      <section className="rounded-xl border border-sc-primary/12 bg-sc-surface/40">
        {loading && nodes.length === 0 ? (
          <div className="flex items-center gap-2 p-6 text-xs text-sc-text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            {t('common.loading')}
          </div>
        ) : nodes.length === 0 ? (
          <EmptyState
            title={t('networkMap.empty.title')}
            body={t('networkMap.empty.body')}
            ctaLabel={t('networkMap.actions.openCenters')}
            onCta={() => navigate('/centri-slide')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-sc-primary/10 text-[11px] uppercase tracking-wide text-sc-text-muted">
                <tr>
                  <th className="px-4 py-2">{t('networkMap.table.device')}</th>
                  <th className="px-4 py-2">{t('networkMap.table.kind')}</th>
                  <th className="px-4 py-2">{t('networkMap.table.event')}</th>
                  <th className="px-4 py-2">{t('networkMap.table.room')}</th>
                  <th className="px-4 py-2">{t('networkMap.table.lastSeen')}</th>
                  <th className="px-4 py-2">{t('networkMap.table.status')}</th>
                  <th className="px-4 py-2 text-right">{t('networkMap.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sc-primary/10">
                {filtered.map((n) => (
                  <NetworkNodeRow
                    key={n.node_id}
                    node={n}
                    locale={locale}
                    nowMs={nowMs}
                    eventName={n.event_id ? eventNames.get(n.event_id) : undefined}
                    roomName={n.room_id ? roomNames.get(n.room_id) : undefined}
                    onMove={() => setMoveTarget(n)}
                  />
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sc-text-muted">
                      {t('networkMap.empty.title')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Move dialog (Gap B) */}
      {moveTarget ? (
        <MoveDeviceDialog
          node={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMoved={(eventName) => {
            setMoveTarget(null);
            toast.success(t('networkMap.moveDialog.successToast', { event: eventName }));
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'primary' | 'green' | 'amber' | 'zinc';
}) {
  const accentMap: Record<typeof accent, string> = {
    primary: 'text-sc-text',
    green: 'text-emerald-400',
    amber: 'text-amber-400',
    zinc: 'text-zinc-400',
  };
  return (
    <div className="rounded-xl border border-sc-primary/12 bg-sc-surface/40 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-sc-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accentMap[accent]}`}>{value}</div>
    </div>
  );
}

function NetworkNodeRow({
  node,
  locale,
  nowMs,
  eventName,
  roomName,
  onMove,
}: {
  node: NetworkNode;
  locale: string;
  nowMs: number;
  eventName: string | undefined;
  roomName: string | undefined;
  onMove: () => void;
}) {
  const { t } = useTranslation();
  const meta = STATUS_META[node.derived_status];
  const isPaired = node.kind === 'paired_device';
  const lastSeenLabel = node.last_seen_at
    ? formatRelative(node.last_seen_at, nowMs, locale)
    : t('desktopDevices.devices.neverSeen');

  return (
    <tr className="hover:bg-sc-primary/5">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          {isPaired ? (
            <Monitor className="size-3.5 text-sc-text-muted" aria-hidden />
          ) : (
            <Server className="size-3.5 text-sc-text-muted" aria-hidden />
          )}
          <span className="font-medium text-sc-text">{node.display_name}</span>
        </div>
        {node.app_version ? (
          <div className="mt-0.5 text-[11px] text-sc-text-muted">
            {t('networkMap.table.appVersion', { v: node.app_version })}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-2">
        <span className="rounded-full border border-sc-primary/15 bg-sc-bg px-2 py-0.5 text-[11px] text-sc-text-muted">
          {isPaired
            ? t('networkMap.filters.kindPaired')
            : t('networkMap.filters.kindDesktop')}
        </span>
      </td>
      <td className="px-4 py-2 text-sc-text-muted">
        {node.event_id ? (eventName ?? node.event_id) : t('networkMap.table.noEvent')}
      </td>
      <td className="px-4 py-2 text-sc-text-muted">
        {node.room_id ? (roomName ?? node.room_id) : t('networkMap.table.noRoom')}
      </td>
      <td className="px-4 py-2 text-sc-text-muted">{lastSeenLabel}</td>
      <td className="px-4 py-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${meta.chip}`}
        >
          <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden />
          {t(meta.label)}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        {isPaired ? (
          <button
            type="button"
            onClick={onMove}
            className="inline-flex items-center gap-1 rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1 text-[11px] text-sc-text hover:bg-sc-primary/10"
          >
            <ArrowRightLeft className="size-3" />
            {t('networkMap.actions.moveToEvent')}
          </button>
        ) : (
          <span className="text-[11px] italic text-sc-text-muted">
            {t('networkMap.actions.moveOnlyForPaired')}
          </span>
        )}
      </td>
    </tr>
  );
}

function EmptyState({
  title,
  body,
  ctaLabel,
  onCta,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Network className="size-8 text-sc-text-muted" aria-hidden />
      <h3 className="text-sm font-medium text-sc-text">{title}</h3>
      <p className="max-w-md text-xs text-sc-text-muted">{body}</p>
      <button
        type="button"
        onClick={onCta}
        className="inline-flex items-center gap-1.5 rounded-md bg-sc-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-accent-light"
      >
        <Server className="size-3.5" />
        {ctaLabel}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MoveDeviceDialog (Gap B)
// ────────────────────────────────────────────────────────────────────────────

function MoveDeviceDialog({
  node,
  onClose,
  onMoved,
}: {
  node: NetworkNode;
  onClose: () => void;
  onMoved: (eventName: string) => void;
}) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<EventLite[]>([]);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ev = await listEventsForMove();
        if (!cancelled) {
          setEvents(ev);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!eventId) {
      setRooms([]);
      setRoomId('');
      return;
    }
    let cancelled = false;
    setLoadingRooms(true);
    setRooms([]);
    setRoomId('');
    void (async () => {
      try {
        const r = await listRoomsForEvent(eventId);
        if (!cancelled) setRooms(r);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoadingRooms(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const submit = useCallback(async () => {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      await moveDeviceToEvent({
        deviceId: node.node_id,
        targetEventId: eventId,
        targetRoomId: roomId || null,
      });
      const evName = events.find((e) => e.id === eventId)?.name ?? eventId;
      onMoved(evName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = mapMoveError(msg, t);
      setError(friendly);
    } finally {
      setBusy(false);
    }
  }, [eventId, roomId, node.node_id, events, onMoved, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-sc-primary/20 bg-sc-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-base font-semibold text-sc-text">{t('networkMap.moveDialog.title')}</h2>
        <p className="mt-1 text-xs text-sc-text-muted">
          {t('networkMap.moveDialog.subtitle', { name: node.display_name })}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sc-text-muted">
              {t('networkMap.moveDialog.eventLabel')}
            </label>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              disabled={loadingEvents || busy}
              className="w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1.5 text-xs text-sc-text focus:border-sc-accent focus:outline-none disabled:opacity-50"
            >
              <option value="">{t('networkMap.moveDialog.eventPlaceholder')}</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} {ev.status ? `· ${ev.status}` : ''}
                </option>
              ))}
            </select>
          </div>

          {eventId ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sc-text-muted">
                {t('networkMap.moveDialog.roomLabel')}
              </label>
              {loadingRooms ? (
                <div className="flex items-center gap-1.5 text-xs text-sc-text-muted">
                  <Loader2 className="size-3 animate-spin" />
                  {t('networkMap.moveDialog.loadingRooms')}
                </div>
              ) : rooms.length === 0 ? (
                <p className="text-xs italic text-sc-text-muted">
                  {t('networkMap.moveDialog.noRoomsForEvent')}
                </p>
              ) : (
                <select
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2 py-1.5 text-xs text-sc-text focus:border-sc-accent focus:outline-none disabled:opacity-50"
                >
                  <option value="">{t('networkMap.moveDialog.roomPlaceholder')}</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger">
              <strong>{t('networkMap.moveDialog.errorTitle')}:</strong> {error}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-sc-primary/20 bg-sc-bg px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10 disabled:opacity-50"
          >
            {t('networkMap.moveDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!eventId || busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-sc-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-accent-light disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                {t('networkMap.moveDialog.movingBusy')}
              </>
            ) : (
              <>
                <ArrowRightLeft className="size-3" />
                {t('networkMap.moveDialog.confirm')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Mappa errori RPC server-side a stringhe i18n user-friendly. Il server alza
// `forbidden`, `event_not_found`, `event_not_in_tenant`, `room_not_in_target_event`,
// `device_not_found` (vedi 20260420020000_sprint_z_move_paired_device.sql).
function mapMoveError(raw: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (raw.includes('forbidden')) return t('networkMap.moveDialog.errorForbidden');
  if (raw.includes('event_not_in_tenant') || raw.includes('event_not_found'))
    return t('networkMap.moveDialog.errorEventNotInTenant');
  if (raw.includes('room_not_in_target_event'))
    return t('networkMap.moveDialog.errorRoomNotInEvent');
  if (raw.includes('device_not_found')) return t('networkMap.moveDialog.errorDeviceNotFound');
  return t('networkMap.moveDialog.errorGeneric', { message: raw });
}

// ────────────────────────────────────────────────────────────────────────────
// Time formatting helper (allineato a desktop-devices ma piu' compatto)
// ────────────────────────────────────────────────────────────────────────────

function formatRelative(iso: string, nowMs: number, locale: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diffSec < 30) return locale.startsWith('it') ? 'adesso' : 'just now';
  if (diffSec < 60) return `${diffSec}s`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default NetworkMapView;
export { NetworkMapView as Component };
