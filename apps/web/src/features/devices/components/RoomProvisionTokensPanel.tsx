// ════════════════════════════════════════════════════════════════════════════
// Sprint U-4 (UX V2.0) — RoomProvisionTokensPanel
// ════════════════════════════════════════════════════════════════════════════
//
// Pannello admin (mostrato per ogni sala in EventDetailView tab Rooms):
// genera magic-link per il provisioning zero-friction del PC sala.
//
// Funzioni:
//   - Lista token attivi (label, scadenza, usi consumati / max). Click per
//     mostrare nuovamente il QR (riutilizzabile fino a max_uses).
//   - "Genera nuovo": dialog con label, validita', max_uses → ricevi URL
//     plain UNA volta sola, mostra QR + pulsante "Stampa".
//   - Revoca atomica.
//
// SICUREZZA: il token plain è dispoonibile in memoria SOLO mentre il dialog
// "appena generato" è aperto. Chiudendolo il valore viene cancellato e non
// può essere recuperato (in DB c'è solo l'hash sha256). Documentato
// chiaramente in UI ("Conserva o stampa adesso").
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, Link2, Printer, Copy, Check, Sparkles, Trash2 } from 'lucide-react';
import { useNowMs } from '@/lib/use-now-ms';
import {
  createRoomProvisionToken,
  listRoomProvisionTokens,
  revokeRoomProvisionToken,
  type CreatedRoomProvisionToken,
  type RoomProvisionToken,
} from '../repository';

interface Props {
  eventId: string;
  roomId: string;
  roomName: string;
  locale: string;
}

type ExpiresPreset = '1h' | '24h' | '7d' | '30d';

const PRESET_MINUTES: Record<ExpiresPreset, number> = {
  '1h': 60,
  '24h': 1440,
  '7d': 7 * 1440,
  '30d': 30 * 1440,
};

export function RoomProvisionTokensPanel({ eventId, roomId, roomName, locale }: Props) {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<RoomProvisionToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Stato dialog "genera nuovo".
  const [genOpen, setGenOpen] = useState(false);
  const [genLabel, setGenLabel] = useState('');
  const [genExpires, setGenExpires] = useState<ExpiresPreset>('24h');
  const [genMaxUses, setGenMaxUses] = useState<number>(1);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Token appena creato (mostrato UNA volta col valore plain).
  const [created, setCreated] = useState<CreatedRoomProvisionToken | null>(null);
  const [copied, setCopied] = useState(false);

  // Revoca: track ids in flight per evitare double-click.
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});

  // Tick ogni minuto: il badge "expired" scatta da una scadenza in ore/giorni,
  // un minuto e' piu' che sufficiente. Senza questo `Date.now()` finirebbe in
  // render path → flag `react-hooks/purity`.
  const nowMs = useNowMs(60_000);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await listRoomProvisionTokens({ eventId, roomId });
      setTokens(rows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [eventId, roomId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitCreate = useCallback(async () => {
    setGenBusy(true);
    setGenError(null);
    try {
      const res = await createRoomProvisionToken({
        eventId,
        roomId,
        expiresMinutes: PRESET_MINUTES[genExpires],
        maxUses: genMaxUses,
        label: genLabel.trim() || null,
      });
      setCreated(res);
      setGenOpen(false);
      setGenLabel('');
      void reload();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenBusy(false);
    }
  }, [eventId, roomId, genExpires, genMaxUses, genLabel, reload]);

  const submitRevoke = useCallback(
    async (tokenId: string) => {
      if (!window.confirm(t('roomProvision.revokeConfirm'))) return;
      setRevoking((m) => ({ ...m, [tokenId]: true }));
      try {
        await revokeRoomProvisionToken(tokenId);
        void reload();
      } catch (err) {
        window.alert(`${t('roomProvision.errorRevoke')}: ${err instanceof Error ? err.message : err}`);
      } finally {
        setRevoking((m) => {
          const next = { ...m };
          delete next[tokenId];
          return next;
        });
      }
    },
    [reload, t],
  );

  return (
    <div className="mt-6 rounded-xl border border-sc-primary/12 bg-sc-surface/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium text-sc-text">
            <Sparkles className="size-4 text-sc-accent" aria-hidden /> {t('roomProvision.title')}
          </h4>
          <p className="mt-1 text-xs text-sc-text-muted">{t('roomProvision.subtitle')}</p>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sc-accent/15 px-3 py-1.5 text-xs font-medium text-sc-accent hover:bg-sc-accent/25"
          onClick={() => setGenOpen(true)}
        >
          <Link2 className="size-3.5" /> {t('roomProvision.generateBtn')}
        </button>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-sc-text-muted">
          <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
        </div>
      )}
      {loadError && (
        <p role="alert" className="mt-4 text-xs text-sc-danger">
          {loadError}
        </p>
      )}

      {!loading && !loadError && tokens.length === 0 && (
        <p className="mt-4 text-xs text-sc-text-muted italic">{t('roomProvision.noActive')}</p>
      )}

      {tokens.length > 0 && (
        <ul className="mt-4 divide-y divide-sc-primary/10">
          {tokens.map((tk) => (
            <RoomProvisionTokenRow
              key={tk.id}
              token={tk}
              locale={locale}
              nowMs={nowMs}
              revoking={Boolean(revoking[tk.id])}
              onRevoke={() => void submitRevoke(tk.id)}
            />
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] text-sc-text-dim italic">{t('roomProvision.fallbackHint')}</p>

      {/* Dialog generazione */}
      {genOpen && (
        <DialogShell onClose={() => (genBusy ? null : setGenOpen(false))} title={t('roomProvision.generateBtn')}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-sc-text-secondary">
                {t('roomProvision.labelLabel')}
              </label>
              <input
                type="text"
                value={genLabel}
                onChange={(e) => setGenLabel(e.target.value.slice(0, 80))}
                /* Audit-fix Sprint U-5+1 (D3): `defaultValue` su react-i18next
                   ritorna il fallback SOLO se la chiave manca; visto che la
                   chiave esiste, prima `roomName` non veniva mai mostrato.
                   Ora la traduzione interpola `{{roomName}}` correttamente. */
                placeholder={t('roomProvision.labelPlaceholder', { roomName })}
                className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2.5 py-1.5 text-sm text-sc-text placeholder:text-sc-text-dim focus:outline-none focus:ring-2 focus:ring-sc-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-sc-text-secondary">
                {t('roomProvision.expiresLabel')}
              </label>
              <select
                value={genExpires}
                onChange={(e) => setGenExpires(e.target.value as ExpiresPreset)}
                className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2.5 py-1.5 text-sm text-sc-text"
              >
                <option value="1h">{t('roomProvision.expires1h')}</option>
                <option value="24h">{t('roomProvision.expires24h')}</option>
                <option value="7d">{t('roomProvision.expires7d')}</option>
                <option value="30d">{t('roomProvision.expires30d')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sc-text-secondary">
                {t('roomProvision.maxUsesLabel')}
              </label>
              <select
                value={genMaxUses}
                onChange={(e) => setGenMaxUses(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2.5 py-1.5 text-sm text-sc-text"
              >
                <option value="1">{t('roomProvision.maxUses1')}</option>
                <option value="3">{t('roomProvision.maxUsesN', { count: 3 })}</option>
                <option value="5">{t('roomProvision.maxUsesN', { count: 5 })}</option>
                <option value="10">{t('roomProvision.maxUsesN', { count: 10 })}</option>
              </select>
            </div>
            {genError && <p className="text-xs text-sc-danger">{genError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={genBusy}
                onClick={() => setGenOpen(false)}
                className="rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={genBusy}
                onClick={() => void submitCreate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-sc-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-accent-light disabled:opacity-50"
              >
                {genBusy && <Loader2 className="size-3.5 animate-spin" />} {t('roomProvision.generateBtn')}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {/* Dialog "appena generato" — mostra il QR + URL plain UNA volta */}
      {created && (
        <DialogShell
          onClose={() => {
            setCreated(null);
            setCopied(false);
          }}
          title={t('roomProvision.successTitle')}
          wide
        >
          <CreatedTokenView
            created={created}
            locale={locale}
            copied={copied}
            onCopied={() => setCopied(true)}
          />
        </DialogShell>
      )}
    </div>
  );
}

// ── Riga lista ──────────────────────────────────────────────────────────────

function RoomProvisionTokenRow({
  token,
  locale,
  nowMs,
  revoking,
  onRevoke,
}: {
  token: RoomProvisionToken;
  locale: string;
  nowMs: number;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();

  const status = useMemo(() => {
    if (token.revoked_at) return 'revoked' as const;
    if (token.consumed_count >= token.max_uses) return 'exhausted' as const;
    if (new Date(token.expires_at).getTime() <= nowMs) return 'expired' as const;
    return 'active' as const;
  }, [token, nowMs]);

  const expiresFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(token.expires_at)),
    [token.expires_at, locale],
  );
  const createdFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(token.created_at)),
    [token.created_at, locale],
  );

  const badgeClass =
    status === 'active'
      ? 'bg-sc-success/15 text-sc-success'
      : status === 'exhausted'
        ? 'bg-sc-warning/15 text-sc-warning'
        : 'bg-sc-text-dim/15 text-sc-text-muted';
  const badgeLabel =
    status === 'active' ? t('roomProvision.activeBadge')
      : status === 'exhausted' ? t('roomProvision.exhaustedBadge')
        : status === 'expired' ? t('roomProvision.expiredBadge')
          : t('roomProvision.revokedBadge');

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badgeClass}`}>
            {badgeLabel}
          </span>
          <span className="truncate text-sm text-sc-text">{token.label || `${t('roomProvision.title')}`}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-sc-text-dim">
          <span>{t('roomProvision.createdAt', { when: createdFmt })}</span>
          <span>{t('roomProvision.expiresAt', { when: expiresFmt })}</span>
          <span>{t('roomProvision.usesCount', { used: token.consumed_count, max: token.max_uses })}</span>
        </div>
      </div>
      {status === 'active' && (
        <button
          type="button"
          disabled={revoking}
          onClick={onRevoke}
          aria-label={t('roomProvision.revokeBtn')}
          className="shrink-0 rounded-md p-1.5 text-sc-text-muted hover:bg-sc-danger/10 hover:text-sc-danger disabled:opacity-50"
        >
          {revoking ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      )}
    </li>
  );
}

// ── Vista "appena generato" ─────────────────────────────────────────────────

function CreatedTokenView({
  created,
  locale,
  copied,
  onCopied,
}: {
  created: CreatedRoomProvisionToken;
  locale: string;
  copied: boolean;
  onCopied: () => void;
}) {
  const { t } = useTranslation();
  // Audit-fix Sprint U-5+1 (D2): wrapper del QR per estrarre l'SVG renderizzato
  // in DOM e iniettarlo nella print window. Cosi' eliminiamo la dipendenza dal
  // CDN esterno `api.qrserver.com` (che leakava il magic-link URL al servizio
  // terzo + bloccava la stampa offline).
  const qrWrapperRef = useRef<HTMLDivElement>(null);
  const url = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.liveslidecenter.com';
    return `${origin}/sala-magic/${created.token}`;
  }, [created.token]);
  const expiresFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(created.expires_at)),
    [created.expires_at, locale],
  );

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(url).then(onCopied);
  }, [url, onCopied]);

  const onPrint = useCallback(() => {
    // Audit-fix D2: estraiamo lo `<svg>` gia' renderizzato dal DOM (vedi
    // `qrWrapperRef`). Risultato:
    //   - Zero richieste a `api.qrserver.com` (privacy: il magic-link non
    //     viene piu' mandato a un CDN terzo per generare l'immagine).
    //   - Funziona offline / dietro proxy aziendali che bloccano CDN.
    //   - Stesso QR esatto che l'utente vede nel dialog (consistency UX).
    // Se il wrapper non e' montato (race condition impossibile in pratica),
    // facciamo fallback a "stampa solo URL" senza QR — l'admin puo' sempre
    // copiare il link.
    const svgEl = qrWrapperRef.current?.querySelector('svg');
    let qrSvgInline = '';
    if (svgEl) {
      const cloned = svgEl.cloneNode(true) as SVGSVGElement;
      cloned.setAttribute('width', '320');
      cloned.setAttribute('height', '320');
      cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      qrSvgInline = cloned.outerHTML;
    }
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(`<!doctype html>
<html><head><title>Magic Link — ${escapeHtml(created.room_id)}</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 32px; color: #111; max-width: 540px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #444; font-size: 14px; margin: 4px 0; }
  .qr { display: flex; justify-content: center; padding: 24px 0; }
  .qr svg { width: 320px; height: 320px; }
  code { display: block; word-break: break-all; background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 13px; }
  .footer { color: #888; font-size: 11px; margin-top: 20px; }
  @media print { body { padding: 16px; } }
</style></head>
<body>
  <h1>Magic Link sala</h1>
  <p>Apri questo URL UNA volta sul PC della sala. Il PC verrà configurato automaticamente.</p>
  <div class="qr">${qrSvgInline || '<p style="color:#888">QR non disponibile, usa l&#39;URL sotto.</p>'}</div>
  <p><strong>URL:</strong></p>
  <code>${escapeHtml(url)}</code>
  <p class="footer">Scade: ${escapeHtml(expiresFmt)} · Max usi: ${created.max_uses}</p>
  <script>
    // QR gia' inline in DOM (estratto dal componente React principale,
    // niente CDN). Lanciamo print() al next tick per assicurarci che il
    // layout sia stato calcolato.
    setTimeout(function(){ window.print(); }, 50);
  </script>
</body></html>`);
    w.document.close();
  }, [url, expiresFmt, created.room_id, created.max_uses]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-sc-text-muted">
        {t('roomProvision.successDesc', { when: expiresFmt })}
      </p>
      <div ref={qrWrapperRef} className="flex justify-center rounded-lg bg-white p-6">
        <QRCodeSVG value={url} size={224} level="M" includeMargin={false} />
      </div>
      <div className="rounded-md border border-sc-primary/15 bg-sc-bg p-2.5">
        <code className="block break-all text-[11px] text-sc-text-secondary">{url}</code>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
        >
          {copied ? <Check className="size-3.5 text-sc-success" /> : <Copy className="size-3.5" />}
          {copied ? t('roomProvision.copyUrlDone') : t('roomProvision.copyUrl')}
        </button>
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-primary/10"
        >
          <Printer className="size-3.5" /> {t('roomProvision.printQr')}
        </button>
      </div>
      <div className="rounded-md border border-sc-warning/30 bg-sc-warning/5 p-3 text-[11px] text-sc-text-secondary">
        <p className="font-medium text-sc-warning">{t('roomProvision.instructionsTitle')}</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>{t('roomProvision.instructions1')}</li>
          <li>{t('roomProvision.instructions2')}</li>
          <li>{t('roomProvision.instructions3')}</li>
        </ol>
      </div>
    </div>
  );
}

// ── Dialog shell minimale (no shadcn dep, evita import cyclic) ─────────────

function DialogShell({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'} rounded-xl border border-sc-primary/20 bg-sc-surface p-5 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-sc-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="rounded-md p-1 text-sc-text-muted hover:bg-sc-primary/10"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
