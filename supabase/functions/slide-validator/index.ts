// ════════════════════════════════════════════════════════════════════════════
// Sprint T-3-A (G10) — slide-validator
// ════════════════════════════════════════════════════════════════════════════
//
// Riceve un array di version_id (max 5 per call) e per ognuna:
//   1) Verifica ownership tenant (cross-tenant safe).
//   2) Genera signed URL Storage e scarica il blob (max 50 MB; oltre = skip).
//   3) Parsa il contenuto a seconda del MIME/estensione (.pptx, .pdf, generico).
//   4) Chiama RPC `record_validation_warnings` per scrivere i warning.
//
// L'uscita "warnings" e' SEMPRE un array (anche vuoto = file pulito).
// Severity:
//   - 'info'    nessuna azione richiesta (es. risoluzione 4:3)
//   - 'warning' azione consigliata (es. font non embedded)
//   - 'error'   il file probabilmente non si aprira' (es. PDF corrotto)
//
// Auth: JWT utente obbligatorio (verify_jwt=true di default).
// Cross-tenant: confronto rigoroso tenant_id JWT vs tenant_id version.
//
// Dipendenze: npm:jszip per parsing PPTX (ZIP+XML scan).
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getAuthenticatedUser } from '../_shared/auth.ts';

interface ValidatorInput {
  version_ids?: string[];
}

interface ValidationWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

interface ValidatorResult {
  version_id: string;
  ok: boolean;
  warnings_count?: number;
  skipped?: boolean;
  reason?: string;
}

const MAX_VERSIONS_PER_CALL = 5;
const MAX_VALIDATE_BYTES = 50 * 1024 * 1024; // 50 MB
const FILE_FETCH_TIMEOUT_MS = 30000; // 30s per file
const SIGNED_URL_TTL_SECONDS = 120;

// Font safe-list: presenti su Windows out-of-box, no embedding necessario.
const SAFE_FONTS = new Set(
  [
    'Arial',
    'Calibri',
    'Calibri Light',
    'Cambria',
    'Cambria Math',
    'Candara',
    'Comic Sans MS',
    'Consolas',
    'Constantia',
    'Corbel',
    'Courier New',
    'Franklin Gothic Medium',
    'Gabriola',
    'Georgia',
    'Impact',
    'Lucida Console',
    'Lucida Sans Unicode',
    'Microsoft Sans Serif',
    'Palatino Linotype',
    'Segoe UI',
    'Segoe UI Light',
    'Segoe UI Semibold',
    'Tahoma',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
    'Wingdings',
    'Wingdings 2',
    'Wingdings 3',
    '+mn-lt',
    '+mn-ea',
    '+mn-cs',
    '+mj-lt',
    '+mj-ea',
    '+mj-cs',
  ].map((s) => s.toLowerCase()),
);

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    let user;
    try {
      user = await getAuthenticatedUser(req);
    } catch {
      return jsonRes({ error: 'unauthorized' }, 401);
    }

    const userTenantId =
      (user.app_metadata?.tenant_id as string | undefined) ??
      (user.user_metadata?.tenant_id as string | undefined);
    if (!userTenantId) {
      return jsonRes({ error: 'no_tenant_in_jwt' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as ValidatorInput;
    const versionIds = Array.isArray(body.version_ids) ? body.version_ids : [];

    const cleanIds = versionIds
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => /^[0-9a-f-]{36}$/i.test(v));

    if (cleanIds.length === 0) {
      return jsonRes({ error: 'no_version_ids' }, 400);
    }

    const limited = cleanIds.slice(0, MAX_VERSIONS_PER_CALL);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Carica le versions (cross-tenant filter applicato lato server).
    const { data: versions, error: vErr } = await supabaseAdmin
      .from('presentation_versions')
      .select('id, tenant_id, storage_key, file_name, file_size_bytes, mime_type, status, validated_at')
      .in('id', limited);

    if (vErr) {
      return jsonRes({ error: 'lookup_failed', detail: vErr.message }, 500);
    }

    const results: ValidatorResult[] = [];

    for (const version of (versions ?? [])) {
      const v = version as {
        id: string;
        tenant_id: string;
        storage_key: string;
        file_name: string;
        file_size_bytes: number;
        mime_type: string;
        status: string;
        validated_at: string | null;
      };

      if (v.tenant_id !== userTenantId) {
        results.push({ version_id: v.id, ok: false, skipped: true, reason: 'cross_tenant_denied' });
        continue;
      }

      if (v.status !== 'ready') {
        results.push({ version_id: v.id, ok: false, skipped: true, reason: 'not_ready' });
        continue;
      }

      if (v.validated_at) {
        results.push({ version_id: v.id, ok: true, skipped: true, reason: 'already_validated' });
        continue;
      }

      let warnings: ValidationWarning[];
      try {
        warnings = await validateVersion(supabaseAdmin, v);
      } catch (err) {
        // Fallimento del validator stesso: registriamo come error severity
        const message = err instanceof Error ? err.message : 'unknown_error';
        warnings = [
          {
            code: 'validator_internal_error',
            severity: 'warning',
            message: `Validator failed: ${message}`,
          },
        ];
      }

      const { error: rpcErr } = await supabaseAdmin.rpc('record_validation_warnings', {
        p_version_id: v.id,
        p_warnings: warnings,
      });

      if (rpcErr) {
        results.push({
          version_id: v.id,
          ok: false,
          reason: `record_failed:${rpcErr.message}`,
        });
        continue;
      }

      results.push({ version_id: v.id, ok: true, warnings_count: warnings.length });
    }

    return jsonRes({ ok: true, processed: results.length, results }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal_error';
    return jsonRes({ error: message }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// validateVersion — orchestratore per singola version
// ────────────────────────────────────────────────────────────────────────────
async function validateVersion(
  supabaseAdmin: ReturnType<typeof createClient>,
  v: {
    id: string;
    storage_key: string;
    file_name: string;
    file_size_bytes: number;
    mime_type: string;
  },
): Promise<ValidationWarning[]> {
  const warnings: ValidationWarning[] = [];
  const ext = extractExtension(v.file_name);

  // Check 1: file too large to download/validate
  if (v.file_size_bytes > MAX_VALIDATE_BYTES) {
    warnings.push({
      code: 'file_too_large_to_validate',
      severity: 'info',
      message: `File ${formatBytes(v.file_size_bytes)} exceeds validator limit (${formatBytes(MAX_VALIDATE_BYTES)}). Validation skipped — please check manually.`,
      details: { size_bytes: v.file_size_bytes, limit_bytes: MAX_VALIDATE_BYTES },
    });
    return warnings;
  }

  // Check 2: file insolitamente grosso (>500 MB) — non bloccante ma segnaliamo
  if (v.file_size_bytes > 500 * 1024 * 1024) {
    warnings.push({
      code: 'file_size_large',
      severity: 'warning',
      message: `File is ${formatBytes(v.file_size_bytes)} — large files may cause download lag on room PCs.`,
      details: { size_bytes: v.file_size_bytes },
    });
    // continua comunque la validazione
  }

  // Genera signed URL e scarica
  const { data: signed, error: sErr } = await supabaseAdmin.storage
    .from('presentations')
    .createSignedUrl(v.storage_key, SIGNED_URL_TTL_SECONDS);

  if (sErr || !signed?.signedUrl) {
    warnings.push({
      code: 'storage_unreachable',
      severity: 'error',
      message: 'Cannot read file from Storage — the underlying object may be missing.',
      details: { storage_error: sErr?.message ?? 'unknown' },
    });
    return warnings;
  }

  const buffer = await fetchWithTimeout(signed.signedUrl, FILE_FETCH_TIMEOUT_MS);
  if (!buffer) {
    warnings.push({
      code: 'fetch_timeout',
      severity: 'warning',
      message: `Download timeout after ${FILE_FETCH_TIMEOUT_MS / 1000}s. Validation incomplete.`,
    });
    return warnings;
  }

  const bytes = new Uint8Array(buffer);

  // Check 3: MIME sniff (verifica che il file sia davvero quello che dice di essere)
  const sniffed = sniffMime(bytes);
  if (sniffed && v.mime_type && sniffed !== v.mime_type && sniffed !== 'unknown') {
    // Filtriamo i casi noti di mismatch innocuo (es. octet-stream)
    if (v.mime_type !== 'application/octet-stream') {
      warnings.push({
        code: 'mime_type_mismatch',
        severity: 'warning',
        message: `Declared "${v.mime_type}" but content is "${sniffed}". File may not open correctly on room PC.`,
        details: { declared: v.mime_type, sniffed },
      });
    }
  }

  // Check 4-N: parser specifico
  if (ext === 'pptx' || sniffed === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    await validatePptx(bytes, warnings);
  } else if (ext === 'pdf' || sniffed === 'application/pdf') {
    validatePdf(bytes, warnings);
  } else {
    // Formato non sottoposto a parser dedicato: nessun warning specifico
    // (lato UX e' OK, l admin sa che video/immagini non sono validati profondamente).
  }

  return warnings;
}

// ────────────────────────────────────────────────────────────────────────────
// PPTX validator: scan ZIP + XML per font non embedded, video con link HTTP, ecc.
// ────────────────────────────────────────────────────────────────────────────
async function validatePptx(bytes: Uint8Array, warnings: ValidationWarning[]): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    warnings.push({
      code: 'pptx_corrupted',
      severity: 'error',
      message: `PPTX archive cannot be opened: ${err instanceof Error ? err.message : 'unknown'}.`,
    });
    return;
  }

  // Verifica entry minima richiesta
  if (!zip.file('ppt/presentation.xml')) {
    warnings.push({
      code: 'pptx_missing_core',
      severity: 'error',
      message: 'PPTX missing required entry ppt/presentation.xml — file may be a renamed ZIP.',
    });
    return;
  }

  // ── Slide size (16:9 vs 4:3 vs custom) ────────────────────────────────────
  try {
    const presentationXml = await zip.file('ppt/presentation.xml')!.async('string');
    const sldSzMatch = presentationXml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/i);
    if (sldSzMatch) {
      const cx = Number(sldSzMatch[1]);
      const cy = Number(sldSzMatch[2]);
      if (cx > 0 && cy > 0) {
        const ratio = cx / cy;
        // 16:9 = 1.777..., 16:10 = 1.6, 4:3 = 1.333...
        if (Math.abs(ratio - 16 / 9) > 0.05) {
          if (Math.abs(ratio - 4 / 3) < 0.05) {
            warnings.push({
              code: 'pptx_aspect_4_3',
              severity: 'info',
              message: 'Slides are 4:3. Most projectors are 16:9 — slides may show black bars on the sides.',
              details: { cx, cy, ratio: ratio.toFixed(3) },
            });
          } else {
            warnings.push({
              code: 'pptx_aspect_custom',
              severity: 'info',
              message: `Custom slide aspect ratio ${ratio.toFixed(2)}:1. Verify it matches the projector format.`,
              details: { cx, cy, ratio: ratio.toFixed(3) },
            });
          }
        }
      }
    }
  } catch {
    /* skip aspect check on parse error */
  }

  // ── Font non embedded ─────────────────────────────────────────────────────
  // Strategia: estraiamo TUTTI i typeface dichiarati negli slide + theme,
  // poi filtriamo via SAFE_FONTS. I rimasti che non sono in ppt/fonts/ → warning.
  const declaredFonts = new Set<string>();
  const fontFileEntries = Object.keys(zip.files).filter((n) => n.startsWith('ppt/fonts/'));

  // Scan theme XMLs (i font del tema sono molto usati)
  const themeFiles = Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n));
  for (const themeFile of themeFiles) {
    try {
      const xml = await zip.file(themeFile)!.async('string');
      collectTypefaces(xml, declaredFonts);
    } catch {
      /* skip on parse error */
    }
  }

  // Scan slide XMLs
  const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const slideFile of slideFiles) {
    try {
      const xml = await zip.file(slideFile)!.async('string');
      collectTypefaces(xml, declaredFonts);
    } catch {
      /* skip on parse error */
    }
  }

  // Filtra: scarta font safe-list, scarta vuoti
  const suspiciousFonts: string[] = [];
  for (const font of declaredFonts) {
    const trimmed = font.trim();
    if (!trimmed) continue;
    if (SAFE_FONTS.has(trimmed.toLowerCase())) continue;
    // Token "+mj-lt" / "+mn-lt" sono placeholder del tema, non font veri
    if (trimmed.startsWith('+')) continue;
    suspiciousFonts.push(trimmed);
  }

  if (suspiciousFonts.length > 0 && fontFileEntries.length === 0) {
    // Nessun font embedded → tutti i suspicious sono potenzialmente broken
    warnings.push({
      code: 'pptx_fonts_not_embedded',
      severity: 'warning',
      message: `Found ${suspiciousFonts.length} non-standard font(s) that are not embedded: ${truncateList(suspiciousFonts, 5)}. They may render with substitution on room PCs.`,
      details: { fonts: suspiciousFonts.slice(0, 20) },
    });
  } else if (suspiciousFonts.length > 0) {
    // Alcuni font embedded, controlliamo se i suspicious sono coperti
    // (PowerPoint embedda i font con nome del tipo "calibri.fntdata").
    const embeddedNames = fontFileEntries
      .map((p) => p.replace('ppt/fonts/', '').replace(/\.[^.]+$/, '').toLowerCase());
    const missing = suspiciousFonts.filter(
      (f) => !embeddedNames.some((e) => e.includes(f.toLowerCase().slice(0, 6))),
    );
    if (missing.length > 0) {
      warnings.push({
        code: 'pptx_fonts_partially_embedded',
        severity: 'warning',
        message: `Some non-standard fonts may not be fully embedded: ${truncateList(missing, 5)}.`,
        details: { suspicious: missing.slice(0, 20), embedded_count: fontFileEntries.length },
      });
    }
  }

  // ── Video con link HTTP (broken link risk) ────────────────────────────────
  const slideRelFiles = Object.keys(zip.files).filter((n) =>
    /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n),
  );
  const externalMediaUrls: string[] = [];
  for (const relFile of slideRelFiles) {
    try {
      const xml = await zip.file(relFile)!.async('string');
      // Cerca <Relationship Type="...video|...media" Target="http..." TargetMode="External">
      const matches = xml.matchAll(
        /<Relationship[^>]*Type="[^"]*(?:video|media|audio)[^"]*"[^>]*Target="(https?:\/\/[^"]+)"[^>]*TargetMode="External"/gi,
      );
      for (const m of matches) {
        externalMediaUrls.push(m[1]);
      }
    } catch {
      /* skip on parse error */
    }
  }
  if (externalMediaUrls.length > 0) {
    warnings.push({
      code: 'pptx_external_media_links',
      severity: 'warning',
      message: `Found ${externalMediaUrls.length} external media link(s) (HTTP). Room PC needs internet to play these. Consider embedding the media inside the file.`,
      details: { urls: externalMediaUrls.slice(0, 10) },
    });
  }
}

// Estrae i typeface da un XML (theme o slide). Cerca tutti gli attributi typeface="..."
function collectTypefaces(xml: string, out: Set<string>): void {
  const re = /typeface="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.add(m[1]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PDF validator: magic bytes + EOF check + page count basic
// ────────────────────────────────────────────────────────────────────────────
function validatePdf(bytes: Uint8Array, warnings: ValidationWarning[]): void {
  // Magic bytes: %PDF- (5 char ASCII)
  if (bytes.length < 5) {
    warnings.push({
      code: 'pdf_too_small',
      severity: 'error',
      message: 'PDF file is too small to be valid.',
    });
    return;
  }

  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  if (head !== '%PDF-') {
    warnings.push({
      code: 'pdf_missing_magic',
      severity: 'error',
      message: 'PDF file does not start with %PDF- header — file is corrupted or not a PDF.',
    });
    return;
  }

  // EOF marker: cerca %%EOF negli ultimi 1024 byte
  const tailStart = Math.max(0, bytes.length - 1024);
  const tail = new TextDecoder('latin1').decode(bytes.subarray(tailStart));
  if (!tail.includes('%%EOF')) {
    warnings.push({
      code: 'pdf_missing_eof',
      severity: 'error',
      message: 'PDF file is missing the %%EOF marker — file may be truncated or corrupted.',
    });
    return;
  }

  // Page count grezzo: conta /Type /Page (non /Pages) negli ultimi 64 KB.
  // Questo e' approssimativo ma sufficiente per detectare PDF a 0 pagine.
  const scanFrom = Math.max(0, bytes.length - 64 * 1024);
  const scanText = new TextDecoder('latin1').decode(bytes.subarray(scanFrom));
  const pageMatches = scanText.match(/\/Type\s*\/Page(?!\s*s)/g);
  const pageCount = pageMatches ? pageMatches.length : 0;
  if (pageCount === 0) {
    warnings.push({
      code: 'pdf_no_pages_detected',
      severity: 'warning',
      message: 'Could not detect any pages in this PDF (may be encrypted or use uncommon structure).',
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function extractExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  // PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf';
  }
  // ZIP (PPTX/DOCX/XLSX): PK\x03\x04
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    // Senza un parse completo del Content_Types non distinguiamo pptx da docx.
    // Per la v1 ritorniamo "zip-office" generico; il caller fa il match su estensione.
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // MP4 (ftyp at offset 4)
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'video/mp4';
  }
  return 'unknown';
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<ArrayBuffer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function truncateList(items: string[], max: number): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} (+${items.length - max} more)`;
}

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
