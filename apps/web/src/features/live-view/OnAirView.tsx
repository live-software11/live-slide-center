import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  Circle,
  Clock,
  Maximize,
  Minimize,
  Tv,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Badge, Button, ScrollArea, Separator, cn } from '@slidecenter/ui';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { getEventById } from '@/features/events/repository';
import { useEventLiveData } from './hooks/useEventLiveData';
import { useActivityFeed } from './hooks/useActivityFeed';
import { ActivityFeed } from './components/ActivityFeed';
import type { LiveRoomData } from './repository';

/**
 * Sprint U-3 (UX redesign V2.0) — OnAirView (regia / on-air).
 *
 * Sostituisce la vecchia LiveRegiaView con un layout split a 3 colonne
 * pensato per il workflow "regia di evento":
 *
 *   ┌──────────────┬─────────────────────────────┬──────────────┐
 *   │ SALE (lista) │  SALA SELEZIONATA (dettaglio) │ ACTIVITY    │
 *   │              │                              │ FEED        │
 *   │ - Sala A  ●  │  ┌──────────────────────┐    │             │
 *   │ - Sala B  ●  │  │     12 / 87          │    │ • file X    │
 *   │ - Sala C  ●  │  │  presentazione.pptx  │    │ • file Y    │
 *   │              │  │  Mario Rossi         │    │             │
 *   └──────────────┴─────────────────────────────┴──────────────┘
 *
 * Mobile (<lg): la lista sale diventa una select orizzontale scrollabile
 * sopra il dettaglio; l'ActivityFeed sfila in fondo.
 *
 * Dati: tutto in arrivo da `useEventLiveData` (Realtime su `room_state`,
 * `presentations`, `presentation_versions`, `rooms`, `sessions`, `speakers`).
 * Per ogni sala sappiamo: file in onda (file_name), slide N/M, started_at.
 *
 * Niente thumbnail-per-slide in MVP (richiede infra di rendering server-
 * side o screenshot agent lato Tauri — out of scope U-3). Mostriamo invece
 * il numero slide N/M in font GIGANTESCO + il file_name e lo speaker.
 */
export default function OnAirView() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const { session, loading: authLoading } = useAuth();
  const tenantId = getTenantIdFromSession(session);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [eventName, setEventName] = useState('');
  const [eventError, setEventError] = useState<string | null>(null);
  /**
   * Sprint U-3: ID sala scelto esplicitamente dall'utente. NULL = "non
   * scelto", in tal caso fallback al primo room disponibile (derived state,
   * vedi `selectedRoomId` sotto). Cosi' evitiamo setState in useEffect
   * (rule react-hooks/set-state-in-effect) e l'auto-select e' puro.
   */
  const [explicitSelectedRoomId, setExplicitSelectedRoomId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!eventId) return;
    void (async () => {
      const { data, error } = await getEventById(supabase, eventId);
      if (error) {
        setEventError(error.message);
        return;
      }
      if (!data) {
        setEventError('not_found');
        return;
      }
      setEventName(data.name);
    })();
  }, [supabase, eventId]);

  const { snapshot, loading, error } = useEventLiveData(eventId ?? null);
  const { entries: activityEntries, loading: activityLoading } = useActivityFeed(
    eventId ?? null,
  );

  const rooms = useMemo(() => snapshot?.rooms ?? [], [snapshot]);

  // Sprint U-3: derived state — se l'utente non ha scelto, default alla prima
  // sala (puro: niente setState in render/effect).
  const selectedRoomId = explicitSelectedRoomId ?? rooms[0]?.room.id ?? null;

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  // Sprint U-3: nowMs per calcoli "avviato Ns fa" senza Date.now() in render.
  // Refresh ogni 5s — sufficiente per il granularita' "1s/2s/3s..." senza
  // sprecare CPU (e l'header timer e' best-effort).
  const nowMs = useNowMs(5000);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      void containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      void document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (authLoading) {
    return <div className="p-6 text-sc-text-muted">{t('common.loading')}</div>;
  }
  if (!tenantId) {
    return (
      <div className="p-6">
        <p className="text-sc-error" role="alert">
          {t('event.errors.missingTenant')}
        </p>
      </div>
    );
  }
  if (!eventId) {
    return (
      <div className="p-6">
        <p className="text-sc-error" role="alert">
          {t('event.errors.invalidRoute')}
        </p>
      </div>
    );
  }
  if (eventError) {
    return (
      <div className="p-6">
        <p className="text-sc-error" role="alert">
          {eventError === 'not_found'
            ? t('event.notFound')
            : `${t('event.errors.load')}: ${eventError}`}
        </p>
        <Link
          to={`/events/${eventId}`}
          className="mt-4 inline-block text-sc-accent hover:underline"
        >
          {t('liveView.backToEvent')}
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sc-error" role="alert">
          {t('liveView.loadError')}: {error}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full min-h-screen flex-col bg-sc-bg text-sc-text',
        isFullscreen && 'fixed inset-0 z-50',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sc-border bg-sc-surface/40 px-6 py-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/events/${eventId}`}>
              <ArrowLeft />
              {t('liveView.backToEvent')}
            </Link>
          </Button>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <div className="hidden sm:block">
            <p className="text-[10px] uppercase tracking-wider text-sc-text-dim">
              {t('onAir.headerKicker')}
            </p>
            <h1 className="truncate text-sm font-semibold text-sc-text">{eventName}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={loading ? 'secondary' : 'success'} className="gap-1">
            {loading ? (
              <>
                <Wifi className="size-3 animate-pulse" /> {t('common.loading')}
              </>
            ) : (
              <>
                <Wifi className="size-3" /> {t('liveView.connected')}
              </>
            )}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            aria-label={t('liveView.toggleFullscreen')}
          >
            {isFullscreen ? <Minimize /> : <Maximize />}
            <span className="hidden sm:inline">
              {isFullscreen ? t('liveView.exitFullscreen') : t('liveView.enterFullscreen')}
            </span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Pane 1: lista sale */}
        <aside className="flex shrink-0 flex-col border-b border-sc-border bg-sc-surface/30 lg:w-72 lg:border-b-0 lg:border-r">
          <div className="px-4 pb-2 pt-3">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-sc-text-dim">
              {t('onAir.roomsListTitle', { count: rooms.length })}
            </h2>
          </div>
          {rooms.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-sc-text-dim">{t('liveView.noRooms')}</p>
          ) : (
            <ScrollArea className="flex-1">
              <ul className="flex flex-row gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-x-visible">
                {rooms.map((roomData) => (
                  <li key={roomData.room.id} className="shrink-0 lg:shrink">
                    <RoomListItem
                      data={roomData}
                      selected={roomData.room.id === selectedRoomId}
                      nowMs={nowMs}
                      onSelect={() => setExplicitSelectedRoomId(roomData.room.id)}
                    />
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </aside>

        {/* Pane 2: dettaglio sala selezionata */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {selectedRoom ? (
            <RoomNowPlayingPanel data={selectedRoom} nowMs={nowMs} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-12 text-sc-text-dim">
              {rooms.length === 0
                ? t('liveView.noRooms')
                : t('onAir.selectRoomPrompt')}
            </div>
          )}
        </main>

        {/* Pane 3: activity feed (lg+) */}
        <aside className="hidden w-80 shrink-0 border-l border-sc-border lg:block">
          <ActivityFeed entries={activityEntries} loading={activityLoading} />
        </aside>
      </div>

      {/* Activity feed mobile (<lg): sotto */}
      <div className="border-t border-sc-border lg:hidden">
        <ActivityFeed entries={activityEntries} loading={activityLoading} />
      </div>
    </div>
  );
}

export { OnAirView as Component };

// ============================================================================
// Sub-components
// ============================================================================

interface RoomListItemProps {
  data: LiveRoomData;
  selected: boolean;
  nowMs: number;
  onSelect: () => void;
}

function RoomListItem({ data, selected, nowMs, onSelect }: RoomListItemProps) {
  const { t } = useTranslation();
  const { room, state, nowPlayingVersion } = data;
  const isOnAir = Boolean(state?.current_presentation_id);
  const ageSec = state?.last_play_started_at
    ? Math.floor((nowMs - new Date(state.last_play_started_at).getTime()) / 1000)
    : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full min-w-[14rem] flex-col rounded-lg border px-3 py-2 text-left text-sm transition lg:min-w-0',
        selected
          ? 'border-sc-accent bg-sc-accent/10 text-sc-text'
          : 'border-sc-border bg-sc-surface/40 text-sc-text-muted hover:border-sc-text-dim hover:bg-sc-surface/70',
      )}
    >
      <div className="flex items-center gap-2">
        <Circle
          className={cn(
            'size-2 fill-current',
            isOnAir ? 'text-sc-error animate-pulse' : 'text-sc-text-dim',
          )}
        />
        <span className="truncate font-medium text-sc-text">{room.name}</span>
        {isOnAir ? (
          <Badge variant="destructive" className="ml-auto h-5 px-1.5 text-[9px] uppercase">
            {t('onAir.badgeOnAir')}
          </Badge>
        ) : (
          <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[9px] uppercase">
            {t('onAir.badgeIdle')}
          </Badge>
        )}
      </div>
      {isOnAir ? (
        <p className="mt-1.5 line-clamp-1 text-xs text-sc-text-dim">
          {nowPlayingVersion?.file_name ?? t('onAir.nowPlayingUnknown')}
        </p>
      ) : null}
      {ageSec !== null && isOnAir ? (
        <p className="mt-0.5 text-[10px] text-sc-text-dim">
          {formatAgo(ageSec, t)}
        </p>
      ) : null}
    </button>
  );
}

function RoomNowPlayingPanel({ data, nowMs }: { data: LiveRoomData; nowMs: number }) {
  const { t } = useTranslation();
  const { room, state, nowPlayingPresentation, nowPlayingVersion, speakers, sessions } = data;

  const isOnAir = Boolean(state?.current_presentation_id);
  const slideIndex = state?.current_slide_index ?? null;
  const slideTotal = state?.current_slide_total ?? null;
  const ageSec = state?.last_play_started_at
    ? Math.floor((nowMs - new Date(state.last_play_started_at).getTime()) / 1000)
    : null;

  // Speaker correlato al file in onda (via speaker_id sulla presentation)
  const nowPlayingSpeaker =
    nowPlayingPresentation?.speaker_id != null
      ? (speakers.find((sp) => sp.id === nowPlayingPresentation.speaker_id) ?? null)
      : null;

  // Sessione corrente (per mostrare "ora in: Sessione X"). Uso `nowMs` per
  // restare puro (no `new Date()` in render).
  const now = new Date(nowMs);
  const currentSession = sessions.find(
    (s) => new Date(s.scheduled_start) <= now && new Date(s.scheduled_end) > now,
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sc-border bg-sc-surface/20 px-6 py-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-sc-text-dim">
            {t('onAir.detailKicker')}
          </p>
          <h2 className="truncate text-2xl font-semibold text-sc-text">{room.name}</h2>
          {currentSession ? (
            <p className="mt-1 text-sm text-sc-text-muted">
              <Clock className="mr-1 inline size-3.5 align-text-bottom" />
              {currentSession.title}
            </p>
          ) : null}
        </div>
        <Badge
          variant={isOnAir ? 'destructive' : 'secondary'}
          className="text-[10px] uppercase"
        >
          {isOnAir ? (
            <>
              <Tv className="mr-1 size-3" /> {t('onAir.badgeOnAir')}
            </>
          ) : (
            <>
              <WifiOff className="mr-1 size-3" /> {t('onAir.badgeIdle')}
            </>
          )}
        </Badge>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        {isOnAir && nowPlayingPresentation ? (
          <>
            {/* Sprint U-3: slide-counter MAXI — il punto focale della regia. */}
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-[12rem] font-bold leading-none text-sc-text sm:text-[16rem]">
                {slideIndex ?? '—'}
              </span>
              <span className="text-5xl font-light text-sc-text-dim sm:text-7xl">/</span>
              <span className="text-5xl font-light text-sc-text-dim sm:text-7xl">
                {slideTotal ?? '—'}
              </span>
            </div>
            <p className="mt-2 text-xs uppercase tracking-widest text-sc-text-dim">
              {t('onAir.slideLabel')}
            </p>
            <div className="mt-6 max-w-2xl text-center">
              <p className="text-lg font-medium text-sc-text">
                {nowPlayingVersion?.file_name ?? t('onAir.nowPlayingUnknown')}
              </p>
              {nowPlayingSpeaker ? (
                <p className="mt-1 text-sm text-sc-text-muted">
                  {nowPlayingSpeaker.full_name}
                </p>
              ) : null}
              {ageSec !== null ? (
                <p className="mt-3 text-xs text-sc-text-dim">
                  {t('onAir.startedAgo', { ago: formatAgo(ageSec, t) })}
                </p>
              ) : null}
              {slideIndex === null ? (
                <p className="mt-3 max-w-md text-[11px] italic text-sc-text-dim">
                  {t('onAir.slideUnknownHint')}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-center">
            <Tv className="mx-auto size-16 text-sc-text-dim" />
            <p className="mt-4 text-lg font-medium text-sc-text">
              {t('onAir.noNowPlayingTitle')}
            </p>
            <p className="mt-2 max-w-sm text-sm text-sc-text-dim">
              {t('onAir.noNowPlayingDesc', { roomName: room.name })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// helper
function formatAgo(seconds: number, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (seconds < 60) return t('onAir.agoSeconds', { count: seconds });
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return t('onAir.agoMinutes', { count: m });
  }
  const h = Math.floor(seconds / 3600);
  return t('onAir.agoHours', { count: h });
}

/**
 * Hook che ritorna `Date.now()` aggiornato ogni `intervalMs` ms. Usato per
 * calcolare "Avviato Ns fa" senza chiamare `Date.now()` durante il render
 * (rule react-hooks/purity).
 */
function useNowMs(intervalMs: number): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
