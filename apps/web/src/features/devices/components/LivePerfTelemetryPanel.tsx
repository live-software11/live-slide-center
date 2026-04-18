import { useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BatteryLow,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  HardDrive,
  Monitor,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useDeviceMetrics } from '../hooks/useDeviceMetrics';
import type { DeviceMetricsRow } from '../repository';
import { useToast } from '@/components/use-toast';
import { Sparkline } from './Sparkline';

/**
 * Sprint T-2 (G9) — LivePerfTelemetryPanel
 *
 * Widget admin che mostra "a colpo d'occhio" lo stato di ogni PC sala
 * dell'evento. Per ogni device:
 * - Status sintetico (sano/warning/critical) calcolato da soglie sovrane.
 * - Numeri big: heap%, storage%, fps, network type, battery%.
 * - Sparkline ultimi 30 min: heap, storage, fps.
 * - Last update timestamp + ip.
 *
 * Soglie sovrane (configurate qui, non in DB perche' devono essere
 * facili da tunare in field):
 * - heap >= 95% → critical, >= 85% → warning
 * - storage_quota >= 95% → critical, >= 90% → warning
 * - fps < 15 (per 1 min) → critical, < 30 → warning
 * - battery < 10% e !charging → critical, < 20% e !charging → warning
 * - cpu >= 95% (desktop only) → critical, >= 85% → warning
 * - ram_used >= 95% → critical, >= 90% → warning
 * - disk_free <= 5% → critical, <= 10% → warning
 *
 * Toast alert: quando un device entra in stato critical e ci resta > 30s,
 * mostriamo un toast warning una sola volta. Stessa cosa al ritorno OK
 * (toast "device tornato sano").
 *
 * Collassabile: di default mostra solo il riepilogo "X / Y device sani".
 * Apri = vedi le card complete. Persistito in localStorage.
 */

interface LivePerfTelemetryPanelProps {
  eventId: string;
  /** Se false, mette in pausa il polling (utile durante operazioni intensive admin). */
  enabled?: boolean;
}

type DeviceHealth = 'healthy' | 'warning' | 'critical' | 'unknown';

interface MetricThresholds {
  warning: number;
  critical: number;
  inverted?: boolean;
}

const THRESHOLDS = {
  heap: { warning: 85, critical: 95 } satisfies MetricThresholds,
  storage: { warning: 90, critical: 95 } satisfies MetricThresholds,
  fps: { warning: 30, critical: 15, inverted: true } satisfies MetricThresholds,
  cpu: { warning: 85, critical: 95 } satisfies MetricThresholds,
  ram: { warning: 90, critical: 95 } satisfies MetricThresholds,
  // disk_free_pct e' la % di disco LIBERO: pochi = male → inverted.
  // Soglie sovrane T-2: <=10% warning, <=5% critical (cfr §0.17.1 STATO_E_TODO.md).
  disk: { warning: 10, critical: 5, inverted: true } satisfies MetricThresholds,
  battery: { warning: 20, critical: 10, inverted: true } satisfies MetricThresholds,
} as const;

const PANEL_OPEN_KEY = 'sc:liveperftelemetry:open';
const ALERT_DEBOUNCE_MS = 30_000;

function classifyValue(value: number | null, t: MetricThresholds): DeviceHealth {
  if (value === null || Number.isNaN(value)) return 'unknown';
  if (t.inverted) {
    if (value <= t.critical) return 'critical';
    if (value <= t.warning) return 'warning';
    return 'healthy';
  }
  if (value >= t.critical) return 'critical';
  if (value >= t.warning) return 'warning';
  return 'healthy';
}

function deviceOverallHealth(row: DeviceMetricsRow): DeviceHealth {
  const latest = row.latest;
  if (!latest) {
    if (row.device.status === 'offline') return 'critical';
    return 'unknown';
  }
  const checks: DeviceHealth[] = [
    classifyValue(latest.js_heap_used_pct, THRESHOLDS.heap),
    classifyValue(latest.storage_quota_used_pct, THRESHOLDS.storage),
    classifyValue(latest.cpu_pct, THRESHOLDS.cpu),
    classifyValue(latest.ram_used_pct, THRESHOLDS.ram),
    classifyValue(latest.fps, THRESHOLDS.fps),
  ];
  if (latest.disk_free_pct !== null) {
    // disk_free_pct: pochi = male (inverted)
    checks.push(classifyValue(latest.disk_free_pct, THRESHOLDS.disk));
  }
  if (latest.battery_pct !== null && latest.battery_charging === false) {
    checks.push(classifyValue(latest.battery_pct, THRESHOLDS.battery));
  }
  if (checks.includes('critical')) return 'critical';
  if (checks.includes('warning')) return 'warning';
  if (checks.every((c) => c === 'unknown')) return 'unknown';
  return 'healthy';
}

function loadPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function savePanelOpen(open: boolean) {
  try {
    localStorage.setItem(PANEL_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function fmtPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}%`;
}

function fmtFps(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}`;
}

function timeAgo(iso: string | null, t: TFunction): string {
  if (!iso) return t('deviceTelemetry.never');
  const d = new Date(iso);
  const elapsed = Date.now() - d.getTime();
  if (elapsed < 5_000) return t('deviceTelemetry.justNow');
  if (elapsed < 60_000) return t('deviceTelemetry.secondsAgo', { n: Math.round(elapsed / 1000) });
  if (elapsed < 3_600_000) return t('deviceTelemetry.minutesAgo', { n: Math.round(elapsed / 60_000) });
  return d.toLocaleTimeString();
}

function HealthDot({ health }: { health: DeviceHealth }) {
  const tone =
    health === 'critical'
      ? 'bg-sc-danger'
      : health === 'warning'
        ? 'bg-sc-warning'
        : health === 'healthy'
          ? 'bg-sc-success'
          : 'bg-sc-text-muted/40';
  const pulse = health === 'critical' ? 'animate-pulse' : '';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone} ${pulse}`} aria-hidden="true" />;
}

function MetricCell({
  icon: Icon,
  label,
  value,
  health,
  sparkValues,
  thresholds,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  health: DeviceHealth;
  sparkValues: number[];
  thresholds: MetricThresholds;
}) {
  const valueColor =
    health === 'critical'
      ? 'text-sc-danger'
      : health === 'warning'
        ? 'text-sc-warning'
        : health === 'healthy'
          ? 'text-sc-success'
          : 'text-sc-text-muted';
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-sc-primary/8 bg-sc-surface/60 px-2.5 py-2">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-sc-text-muted">
          <Icon className="h-3 w-3" />
          <span>{label}</span>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${valueColor}`}>{value}</span>
      </div>
      <Sparkline
        values={sparkValues}
        warningAt={thresholds.warning}
        criticalAt={thresholds.critical}
        inverted={thresholds.inverted}
        width={120}
        height={20}
      />
    </div>
  );
}

function DeviceTelemetryCard({
  row,
  onAlert,
}: {
  row: DeviceMetricsRow;
  onAlert: (deviceId: string, deviceName: string, health: DeviceHealth) => void;
}) {
  const { t } = useTranslation();
  const health = deviceOverallHealth(row);
  const latest = row.latest;
  const pings = row.pings;

  // Notifica al parent il cambio di stato (per debounced toast).
  useEffect(() => {
    onAlert(row.device.id, row.device.name, health);
  }, [row.device.id, row.device.name, health, onAlert]);

  const heapValues = useMemo(
    () => pings.map((p) => p.js_heap_used_pct).filter((v): v is number => typeof v === 'number'),
    [pings],
  );
  const storageValues = useMemo(
    () => pings.map((p) => p.storage_quota_used_pct).filter((v): v is number => typeof v === 'number'),
    [pings],
  );
  const fpsValues = useMemo(
    () => pings.map((p) => p.fps).filter((v): v is number => typeof v === 'number'),
    [pings],
  );
  const cpuValues = useMemo(
    () => pings.map((p) => p.cpu_pct).filter((v): v is number => typeof v === 'number'),
    [pings],
  );
  const ramValues = useMemo(
    () => pings.map((p) => p.ram_used_pct).filter((v): v is number => typeof v === 'number'),
    [pings],
  );

  const isCenter = row.device.role === 'control_center';
  const visibility = latest?.visibility ?? null;
  const isHidden = visibility === 'hidden';
  const network = latest?.network_type ?? '—';
  const battery = latest?.battery_pct ?? null;
  const batteryCharging = latest?.battery_charging ?? null;
  const isOffline = row.device.status !== 'online' || !latest;
  const sourceLabel = latest?.source ?? null;

  const cardBg =
    health === 'critical'
      ? 'border-sc-danger/40 bg-sc-danger/8'
      : health === 'warning'
        ? 'border-sc-warning/40 bg-sc-warning/8'
        : health === 'healthy'
          ? 'border-sc-success/30 bg-sc-success/5'
          : 'border-sc-primary/10 bg-sc-surface/40';

  return (
    <article
      className={`rounded-xl border p-3 transition-colors ${cardBg}`}
      aria-label={t('deviceTelemetry.cardAria', { name: row.device.name, health: t(`deviceTelemetry.health.${health}`) })}
    >
      {/* Header */}
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <HealthDot health={health} />
          {isCenter ? (
            <Building2 className="h-4 w-4 shrink-0 text-sc-primary" />
          ) : (
            <Monitor className="h-4 w-4 shrink-0 text-sc-text-muted" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-sc-text">
              <span className="truncate" title={row.device.name}>
                {row.device.name}
              </span>
              {isCenter && (
                <span className="rounded-full bg-sc-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sc-primary">
                  {t('deviceTelemetry.centerBadge')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-sc-text-muted">
              {isOffline ? (
                <>
                  <WifiOff className="h-3 w-3 text-sc-danger" />
                  <span className="text-sc-danger">{t('deviceTelemetry.offline')}</span>
                </>
              ) : (
                <>
                  {isHidden ? (
                    <span title={t('deviceTelemetry.hiddenTab')} className="inline-flex">
                      <EyeOff className="h-3 w-3 text-sc-warning" />
                    </span>
                  ) : (
                    <span title={t('deviceTelemetry.visibleTab')} className="inline-flex">
                      <Eye className="h-3 w-3 text-sc-success" />
                    </span>
                  )}
                  <span>{network}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span title={row.device.last_seen_at ?? ''}>
                {timeAgo(row.device.last_seen_at, t)}
              </span>
              {sourceLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="rounded bg-sc-elevated px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-sc-text-secondary">
                    {sourceLabel}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {battery !== null && (
          <div
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${classifyValue(batteryCharging === false ? battery : 100, THRESHOLDS.battery) === 'critical'
                ? 'bg-sc-danger/10 text-sc-danger'
                : classifyValue(batteryCharging === false ? battery : 100, THRESHOLDS.battery) === 'warning'
                  ? 'bg-sc-warning/10 text-sc-warning'
                  : 'bg-sc-success/10 text-sc-success'
              }`}
            title={
              batteryCharging
                ? t('deviceTelemetry.batteryCharging', { pct: battery.toFixed(0) })
                : t('deviceTelemetry.batteryDischarging', { pct: battery.toFixed(0) })
            }
          >
            <BatteryLow className="h-3 w-3" />
            <span>
              {battery.toFixed(0)}%{batteryCharging ? '⚡' : ''}
            </span>
          </div>
        )}
      </header>

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <MetricCell
          icon={Activity}
          label={t('deviceTelemetry.metric.heap')}
          value={fmtPct(latest?.js_heap_used_pct ?? null)}
          health={classifyValue(latest?.js_heap_used_pct ?? null, THRESHOLDS.heap)}
          sparkValues={heapValues}
          thresholds={THRESHOLDS.heap}
        />
        <MetricCell
          icon={HardDrive}
          label={t('deviceTelemetry.metric.storage')}
          value={fmtPct(latest?.storage_quota_used_pct ?? null)}
          health={classifyValue(latest?.storage_quota_used_pct ?? null, THRESHOLDS.storage)}
          sparkValues={storageValues}
          thresholds={THRESHOLDS.storage}
        />
        <MetricCell
          icon={Gauge}
          label={t('deviceTelemetry.metric.fps')}
          value={fmtFps(latest?.fps ?? null)}
          health={classifyValue(latest?.fps ?? null, THRESHOLDS.fps)}
          sparkValues={fpsValues}
          thresholds={THRESHOLDS.fps}
        />
        {/* CPU/RAM solo se source=desktop (popolati). Sennò skip. */}
        {sourceLabel === 'desktop' && (
          <>
            <MetricCell
              icon={Cpu}
              label={t('deviceTelemetry.metric.cpu')}
              value={fmtPct(latest?.cpu_pct ?? null)}
              health={classifyValue(latest?.cpu_pct ?? null, THRESHOLDS.cpu)}
              sparkValues={cpuValues}
              thresholds={THRESHOLDS.cpu}
            />
            <MetricCell
              icon={Activity}
              label={t('deviceTelemetry.metric.ram')}
              value={fmtPct(latest?.ram_used_pct ?? null)}
              health={classifyValue(latest?.ram_used_pct ?? null, THRESHOLDS.ram)}
              sparkValues={ramValues}
              thresholds={THRESHOLDS.ram}
            />
          </>
        )}
      </div>

      {/* Footer compact: extras */}
      {latest && (
        <footer className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-sc-text-muted">
          {latest.app_uptime_sec !== null && (
            <span title={t('deviceTelemetry.uptimeTitle')}>
              {t('deviceTelemetry.uptime')}: {formatUptime(latest.app_uptime_sec, t)}
            </span>
          )}
          {latest.playback_mode && (
            <span title={t('deviceTelemetry.playbackModeTitle')}>
              {t('deviceTelemetry.playbackMode')}:{' '}
              <span className="font-semibold text-sc-text-secondary">{latest.playback_mode}</span>
            </span>
          )}
          {latest.network_downlink_mbps && (
            <span title={t('deviceTelemetry.downlinkTitle')}>
              <Wifi className="mr-0.5 inline h-2.5 w-2.5" />
              {latest.network_downlink_mbps.toFixed(1)} Mbps
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

function formatUptime(sec: number, t: TFunction): string {
  if (sec < 60) return t('deviceTelemetry.uptimeSec', { n: sec });
  if (sec < 3600) return t('deviceTelemetry.uptimeMin', { n: Math.round(sec / 60) });
  if (sec < 86400) return t('deviceTelemetry.uptimeHour', { n: (sec / 3600).toFixed(1) });
  return t('deviceTelemetry.uptimeDay', { n: (sec / 86400).toFixed(1) });
}

export function LivePerfTelemetryPanel({ eventId, enabled = true }: LivePerfTelemetryPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { rows, loading, error, lastRefreshAt, refresh } = useDeviceMetrics(eventId, {
    enabled,
    windowMin: 30,
    maxPingsPerDevice: 60,
    refreshMs: 8_000,
  });

  // Default: chiuso (i numeri big restano sempre visibili nel summary header).
  const [open, setOpen] = useStatePersisted();

  // Sprint T-2: alert debounced. Tracciamo per ogni device:
  //  - lastHealth (health corrente)
  //  - sinceTs (quando lo stato e' iniziato)
  //  - notified (gia' mostrato il toast)
  // Mostriamo il toast SOLO se lo stato critical/warning persiste >= 30s.
  // Quando torna 'healthy' dopo essere stato critical >=30s, toast verde.
  const alertStateRef = useRef<Map<string, { health: DeviceHealth; sinceTs: number; notified: boolean }>>(new Map());

  const onAlert = useMemo(() => {
    return (deviceId: string, deviceName: string, health: DeviceHealth) => {
      const map = alertStateRef.current;
      const now = Date.now();
      const prev = map.get(deviceId);
      if (!prev || prev.health !== health) {
        // Stato cambiato: resetta timer (debounce).
        // Se il prev era 'critical' notified=true e ora siamo healthy, lancia "recovered".
        if (prev && prev.notified && prev.health === 'critical' && health === 'healthy') {
          toast.success(t('deviceTelemetry.alertRecovered.title'), {
            description: t('deviceTelemetry.alertRecovered.body', { name: deviceName }),
            duration: 6_000,
          });
        }
        map.set(deviceId, { health, sinceTs: now, notified: false });
        return;
      }
      // Stato stabile: se siamo in critical/warning da >= debounce e non gia' notificato, fire toast.
      if (
        !prev.notified &&
        (health === 'critical' || health === 'warning') &&
        now - prev.sinceTs >= ALERT_DEBOUNCE_MS
      ) {
        if (health === 'critical') {
          toast.error(t('deviceTelemetry.alertCritical.title'), {
            description: t('deviceTelemetry.alertCritical.body', { name: deviceName }),
            duration: 12_000,
          });
        } else {
          toast.warning(t('deviceTelemetry.alertWarning.title'), {
            description: t('deviceTelemetry.alertWarning.body', { name: deviceName }),
            duration: 8_000,
          });
        }
        map.set(deviceId, { ...prev, notified: true });
      }
    };
  }, [toast, t]);

  const summary = useMemo(() => {
    const total = rows.length;
    let healthy = 0;
    let warning = 0;
    let critical = 0;
    let unknown = 0;
    for (const row of rows) {
      const h = deviceOverallHealth(row);
      if (h === 'healthy') healthy++;
      else if (h === 'warning') warning++;
      else if (h === 'critical') critical++;
      else unknown++;
    }
    return { total, healthy, warning, critical, unknown };
  }, [rows]);

  // Se 0 device, nascondiamo del tutto il pannello (no rumore UI).
  if (!loading && rows.length === 0) return null;

  return (
    <section
      className="rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-3"
      aria-labelledby="live-perf-telemetry-title"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="live-perf-telemetry-body"
        >
          {open ? <ChevronDown className="h-4 w-4 text-sc-text-muted" /> : <ChevronRight className="h-4 w-4 text-sc-text-muted" />}
          <Gauge className="h-4 w-4 text-sc-primary" />
          <h3 id="live-perf-telemetry-title" className="text-sm font-semibold text-sc-text">
            {t('deviceTelemetry.title')}
          </h3>
          {/* Status badges */}
          <div className="ml-1 flex items-center gap-1.5 text-xs">
            {summary.healthy > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sc-success/30 bg-sc-success/10 px-2 py-0.5 text-sc-success">
                <CheckCircle2 className="h-3 w-3" />
                {summary.healthy}
              </span>
            )}
            {summary.warning > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sc-warning/30 bg-sc-warning/10 px-2 py-0.5 text-sc-warning">
                <AlertTriangle className="h-3 w-3" />
                {summary.warning}
              </span>
            )}
            {summary.critical > 0 && (
              <span className="inline-flex animate-pulse items-center gap-1 rounded-full border border-sc-danger/40 bg-sc-danger/10 px-2 py-0.5 text-sc-danger">
                <AlertTriangle className="h-3 w-3" />
                {summary.critical}
              </span>
            )}
            {summary.unknown > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-sc-text-muted/30 bg-sc-elevated px-2 py-0.5 text-sc-text-muted"
                title={t('deviceTelemetry.unknownTitle')}
              >
                <WifiOff className="h-3 w-3" />
                {summary.unknown}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1.5 text-xs text-sc-text-muted">
          {error ? (
            <span className="text-sc-danger" title={error}>
              {t('deviceTelemetry.errorBadge')}
            </span>
          ) : lastRefreshAt ? (
            <span title={lastRefreshAt.toISOString()}>
              {t('deviceTelemetry.lastRefresh', { time: lastRefreshAt.toLocaleTimeString() })}
            </span>
          ) : loading ? (
            <span>{t('common.loading')}</span>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded-md border border-sc-primary/15 bg-sc-surface px-1.5 py-1 hover:bg-sc-elevated"
            title={t('deviceTelemetry.refreshTitle')}
            aria-label={t('deviceTelemetry.refreshTitle')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {open && (
        <div id="live-perf-telemetry-body" className="mt-3">
          {rows.length === 0 ? (
            <p className="py-2 text-center text-xs text-sc-text-muted">
              {loading ? t('common.loading') : t('deviceTelemetry.noDevices')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <DeviceTelemetryCard key={row.device.id} row={row} onAlert={onAlert} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Helper: stato boolean persistito in localStorage (panel open/closed).
function useStatePersisted(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? loadPanelOpen() : false,
  );
  const set = (v: boolean) => {
    setOpen(v);
    savePanelOpen(v);
  };
  return [open, set];
}
