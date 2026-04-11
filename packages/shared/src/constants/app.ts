export const APP_SLUG = 'live-slide-center' as const;
export const APP_NAME = 'Live SLIDE CENTER' as const;
export const APP_VERSION = '0.0.1' as const;

export const SUPABASE_REALTIME_TABLES = [
  'room_state',
  'presentation_versions',
  'local_agents',
  'activity_log',
] as const;

export const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024; // 6 MB
export const AGENT_HEARTBEAT_INTERVAL_MS = 30_000;
export const AGENT_DEFAULT_PORT = 8080;
