// Wrapper tus-js-client per Supabase Storage TUS endpoint.
// Supabase espone TUS resumable a {SUPABASE_URL}/storage/v1/upload/resumable.
// Documentazione: https://supabase.com/docs/guides/storage/uploads/resumable-uploads

import * as tus from 'tus-js-client';

export interface TusUploadOptions {
  supabaseUrl: string;
  anonKey: string;
  bucket: string;
  objectName: string;
  file: File;
  onProgress: (uploaded: number, total: number) => void;
  onSuccess: () => void;
  onError: (err: Error) => void;
}

export interface TusHandle {
  abort(): void;
}

const CHUNK_SIZE = 6 * 1024 * 1024; // richiesto dallo Storage: 6 MiB fissi

export function startTusUpload(opts: TusUploadOptions): TusHandle {
  const upload = new tus.Upload(opts.file, {
    endpoint: `${opts.supabaseUrl}/storage/v1/upload/resumable`,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    headers: {
      authorization: `Bearer ${opts.anonKey}`,
      'x-upsert': 'true',
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      bucketName: opts.bucket,
      objectName: opts.objectName,
      contentType: opts.file.type || 'application/octet-stream',
      cacheControl: '3600',
    },
    chunkSize: CHUNK_SIZE,
    onError: (err) => {
      opts.onError(err instanceof Error ? err : new Error(String(err)));
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      opts.onProgress(bytesUploaded, bytesTotal);
    },
    onSuccess: () => {
      opts.onSuccess();
    },
  });

  upload.findPreviousUploads().then((previous) => {
    if (previous.length > 0 && previous[0]) {
      upload.resumeFromPreviousUpload(previous[0]);
    }
    upload.start();
  });

  return {
    abort() {
      void upload.abort(true);
    },
  };
}
