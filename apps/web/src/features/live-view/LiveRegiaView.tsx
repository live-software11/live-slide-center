import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { getEventById } from '@/features/events/repository';
import { useEventLiveData } from './hooks/useEventLiveData';
import { useActivityFeed } from './hooks/useActivityFeed';
import { EventSummaryBar } from './components/EventSummaryBar';
import { RoomGrid } from './components/RoomGrid';
import { ActivityFeed } from './components/ActivityFeed';

export default function LiveRegiaView() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const { session, loading: authLoading } = useAuth();
  const tenantId = getTenantIdFromSession(session);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [eventName, setEventName] = useState<string>('');
  const [eventError, setEventError] = useState<string | null>(null);
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
  const { entries: activityEntries, loading: activityLoading } = useActivityFeed(eventId ?? null);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      void containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      void document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (authLoading) {
    return <div className="p-8 text-zinc-400">{t('common.loading')}</div>;
  }

  if (!tenantId) {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">{t('event.errors.missingTenant')}</p>
      </div>
    );
  }

  if (!eventId) {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">{t('event.errors.invalidRoute')}</p>
      </div>
    );
  }

  if (eventError) {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">
          {eventError === 'not_found' ? t('event.notFound') : `${t('event.errors.load')}: ${eventError}`}
        </p>
        <Link to={`/events/${eventId}`} className="mt-4 inline-block text-blue-500 hover:underline">
          {t('liveView.backToEvent')}
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">{t('liveView.loadError')}: {error}</p>
        <Link to={`/events/${eventId}`} className="mt-4 inline-block text-blue-500 hover:underline">
          {t('liveView.backToEvent')}
        </Link>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex min-h-screen flex-col bg-[#0A0A0B] ${isFullscreen ? 'p-4' : 'p-6 lg:p-8'}`}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/events/${eventId}`}
            className="text-sm text-zinc-400 hover:text-zinc-200"
            aria-label={t('liveView.backToEvent')}
          >
            ← {t('liveView.backToEvent')}
          </Link>
          <span className="inline-flex items-center rounded border border-blue-900/60 bg-blue-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
            {t('liveView.badge')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" title={t('common.loading')} />
          ) : (
            <span className="h-2 w-2 rounded-full bg-emerald-500" title={t('liveView.connected')} />
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            aria-label={t('liveView.toggleFullscreen')}
          >
            {isFullscreen ? t('liveView.exitFullscreen') : t('liveView.enterFullscreen')}
          </button>
        </div>
      </header>

      {snapshot ? (
        <>
          <EventSummaryBar snapshot={snapshot} eventName={eventName} />

          <div className="mt-4 flex flex-1 gap-4">
            <div className="min-w-0 flex-1">
              {snapshot.rooms.length === 0 ? (
                <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-[#141416] py-20">
                  <p className="text-sm text-zinc-500">{t('liveView.noRooms')}</p>
                </div>
              ) : (
                <RoomGrid snapshot={snapshot} />
              )}
            </div>
            <aside className="hidden w-80 shrink-0 xl:block">
              <ActivityFeed entries={activityEntries} loading={activityLoading} />
            </aside>
          </div>

          <div className="mt-4 xl:hidden">
            <ActivityFeed entries={activityEntries} loading={activityLoading} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-zinc-400">{t('common.loading')}</p>
        </div>
      )}
    </div>
  );
}

export { LiveRegiaView as Component };
