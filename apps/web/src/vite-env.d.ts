/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
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
