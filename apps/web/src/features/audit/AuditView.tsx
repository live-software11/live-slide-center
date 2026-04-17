import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  ClipboardList,
  Filter,
  RefreshCcw,
  ChevronLeft,
  ChevronRight,
  Eraser,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useToast } from '@/components/use-toast';
import {
  listTenantActivity,
  type TenantActivityFilters,
  type TenantActivityPage,
  type TenantActivityRow,
} from './repository';

const PAGE_SIZE = 50;

/**
 * Sprint 8 — Audit log esposto agli admin del tenant.
 *
 * Mostra `activity_log` filtrato per tenant corrente con filtri data/azione/
 * tipo entita' e paginazione. Utile per:
 *   - tracciabilita' GDPR / audit interno
 *   - debug operativo (chi ha pubblicato cosa, quando)
 *   - verifica accessi speaker / agent durante un evento
 *
 * RPC `list_tenant_activity` (SECURITY DEFINER) garantisce isolamento tenant.
 */
export default function AuditView() {
  const { t, i18n } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const toast = useToast();

  const [filters, setFilters] = useState<TenantActivityFilters>({});
  const [page, setPage] = useState<TenantActivityPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  // Bozze separate per gli input (applicate solo al click "Filtra"), evita
  // refetch ad ogni keystroke.
  const [draftAction, setDraftAction] = useState('');
  const [draftEntity, setDraftEntity] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const cancelledRef = useRef(false);

  const refresh = useCallback(
    async (nextOffset: number, nextFilters: TenantActivityFilters) => {
      setLoading(true);
      try {
        const result = await listTenantActivity(supabase, nextFilters, {
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (cancelledRef.current) return;
        setPage(result);
      } catch (err) {
        toast.error(t('audit.errorTitle'), {
          description: err instanceof Error ? err.message : 'unknown',
        });
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    },
    [supabase, toast, t],
  );

  useEffect(() => {
    cancelledRef.current = false;
    void refresh(offset, filters);
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh, offset, filters]);

  const applyFilters = () => {
    const next: TenantActivityFilters = {
      action: draftAction.trim() || null,
      entityType: draftEntity.trim() || null,
      from: draftFrom ? new Date(draftFrom).toISOString() : null,
      to: draftTo ? new Date(draftTo).toISOString() : null,
    };
    setOffset(0);
    setFilters(next);
  };

  const clearFilters = () => {
    setDraftAction('');
    setDraftEntity('');
    setDraftFrom('');
    setDraftTo('');
    setOffset(0);
    setFilters({});
  };

  const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';
  const total = page?.total ?? 0;
  const currentEnd = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = page?.hasMore ?? false;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-2">
        <Link to="/" className="text-xs font-medium text-sc-text-dim hover:text-sc-primary">
          ← {t('nav.dashboard')}
        </Link>
      </div>
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sc-primary/20 bg-sc-primary/10 text-sc-primary">
          <ClipboardList className="h-6 w-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-sc-text">{t('audit.title')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sc-text-muted">
            {t('audit.intro')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(offset, filters)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/20 px-3 py-1.5 text-xs font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/10 disabled:opacity-60"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </header>

      <section className="mt-6 rounded-2xl border border-sc-primary/15 bg-sc-surface p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sc-text-dim">
          <Filter className="h-3.5 w-3.5" />
          {t('audit.filtersTitle')}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterField
            label={t('audit.filterAction')}
            value={draftAction}
            onChange={setDraftAction}
            placeholder="presentation_uploaded"
          />
          <FilterField
            label={t('audit.filterEntity')}
            value={draftEntity}
            onChange={setDraftEntity}
            placeholder="presentation"
          />
          <FilterField
            label={t('audit.filterFrom')}
            value={draftFrom}
            onChange={setDraftFrom}
            type="datetime-local"
          />
          <FilterField
            label={t('audit.filterTo')}
            value={draftTo}
            onChange={setDraftTo}
            type="datetime-local"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFilters}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sc-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sc-primary-strong disabled:opacity-60"
          >
            {t('audit.applyFilters')}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/20 px-4 py-2 text-xs font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/10 disabled:opacity-60"
          >
            <Eraser className="h-3.5 w-3.5" />
            {t('audit.clearFilters')}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-sc-primary/15 bg-sc-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sc-primary/10 px-5 py-3 text-xs text-sc-text-muted">
          <span>{t('audit.totalRecords', { count: total })}</span>
          {total > 0 ? (
            <span>
              {t('audit.showingRange', {
                from: offset + 1,
                to: currentEnd,
                total,
              })}
            </span>
          ) : null}
        </div>
        {loading && !page ? (
          <p className="px-5 py-8 text-sm text-sc-text-muted">{t('common.loading')}</p>
        ) : !page || page.rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-sc-text-muted">{t('audit.empty')}</p>
        ) : (
          <ul className="divide-y divide-sc-primary/10">
            {page.rows.map((row) => (
              <ActivityRowItem key={row.id} row={row} locale={locale} />
            ))}
          </ul>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-sc-primary/10 px-5 py-3">
          <button
            type="button"
            onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
            disabled={!canPrev || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/10 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t('audit.previous')}
          </button>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!canNext || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-sc-primary/20 px-3 py-1.5 text-xs font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/10 disabled:opacity-40"
          >
            {t('audit.next')}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
}

function FilterField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'datetime-local';
}) {
  return (
    <label className="block text-xs font-medium text-sc-text-muted">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-sc-primary/20 bg-sc-bg px-2.5 py-1.5 text-sm text-sc-text outline-none transition-colors placeholder:text-sc-text-dim focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
      />
    </label>
  );
}

function ActivityRowItem({ row, locale }: { row: TenantActivityRow; locale: string }) {
  const { t } = useTranslation();
  const ts = new Date(row.created_at).toLocaleString(locale);
  const actorLabel = row.actor_name ?? row.actor_id ?? row.actor;
  const entityLabel = row.entity_type
    ? `${row.entity_type}${row.entity_id ? `#${row.entity_id.slice(0, 6)}` : ''}`
    : '—';
  const metadataKeys = row.metadata ? Object.keys(row.metadata).length : 0;

  return (
    <li className="px-5 py-3 hover:bg-sc-bg/40">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-mono text-xs text-sc-text-dim">{ts}</span>
        <span className="font-semibold text-sc-text">{row.action}</span>
        <span className="text-xs text-sc-text-muted">
          {t('audit.byActor', { actor: actorLabel, type: row.actor })}
        </span>
        <span className="text-xs text-sc-text-dim">{entityLabel}</span>
      </div>
      {metadataKeys > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-sc-text-dim hover:text-sc-primary">
            {t('audit.showMetadata', { count: metadataKeys })}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md border border-sc-primary/10 bg-sc-bg/60 p-2 text-[10px] text-sc-text-muted">
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

export { AuditView as Component };
