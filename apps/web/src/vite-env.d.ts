/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
  /** Checkout Lemon Squeezy (Starter) — opzionale, Fase 11 */
  readonly VITE_LEMONSQUEEZY_CHECKOUT_STARTER_URL?: string;
  /** Checkout Lemon Squeezy (Pro) — opzionale */
  readonly VITE_LEMONSQUEEZY_CHECKOUT_PRO_URL?: string;
  /** Portale cliente Lemon (gestione abbonamento) — opzionale */
  readonly VITE_LEMONSQUEEZY_CUSTOMER_PORTAL_URL?: string;
  /** URL pubblico Live WORKS APP (marketing / suite licenze) — opzionale, mostrato in onboarding/help */
  readonly VITE_LIVE_WORKS_APP_URL?: string;
  /** Sentry browser SDK — opzionale, Fase 14 */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// File System Access API (Chrome 86+ / Edge 86+)
// https://wicg.github.io/file-system-access/
type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemDirectoryHandle {
  queryPermission(descriptor: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: { mode?: FileSystemPermissionMode }): Promise<FileSystemDirectoryHandle>;
}
