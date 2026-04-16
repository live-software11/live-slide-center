export interface IntegrationsEnvUrls {
  liveSpeakerTimer: string | null;
  liveCrew: string | null;
}

function pickUrl(v: string | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
}

/** Deep link app ecosistema — opzionali in `.env` root (Vite `envDir`). Fase 13 (100%). */
export function getIntegrationsEnvUrls(): IntegrationsEnvUrls {
  const e = import.meta.env;
  return {
    liveSpeakerTimer: pickUrl(e.VITE_LIVE_SPEAKER_TIMER_URL),
    liveCrew: pickUrl(e.VITE_LIVE_CREW_URL),
  };
}
