import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import type { Database } from '@slidecenter/shared';

type Invitation = Database['public']['Tables']['team_invitations']['Row'];
type InviteRole = 'admin' | 'coordinator' | 'tech';

const INVITABLE_ROLES: InviteRole[] = ['admin', 'coordinator', 'tech'];

function inviteStatus(inv: Invitation): 'accepted' | 'expired' | 'pending' {
  if (inv.accepted_at) return 'accepted';
  if (new Date(inv.invite_token_expires_at) < new Date()) return 'expired';
  return 'pending';
}

export default function TeamView() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const userId = session?.user.id ?? '';
  const tenantId = session?.user.app_metadata?.tenant_id as string | undefined;
  const role = session?.user.app_metadata?.role as string | undefined;
  const isAdmin = role === 'admin';

  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Dialog stato
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('coordinator');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Invito appena creato
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('team_invitations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setLoading(false);
    if (error) {
      setLoadError(t('team.loadError'));
      return;
    }
    setInvites(data ?? []);
  }, [supabase, tenantId, t]);

  useEffect(() => {
    // Microtask evita setState sync nell'effect (react-hooks/set-state-in-effect)
    void Promise.resolve().then(() => reload());
  }, [reload]);

  const handleCreate = useCallback(async () => {
    if (!tenantId || !userId || !inviteEmail.trim()) return;
    setCreating(true);
    setCreateError(null);
    setCreatedLink(null);

    const token = crypto.randomUUID();

    const { error } = await supabase.from('team_invitations').insert({
      tenant_id: tenantId,
      email: inviteEmail.trim().toLowerCase(),
      role: inviteRole,
      invited_by_user_id: userId,
      invite_token: token,
    });

    setCreating(false);
    if (error) {
      setCreateError(t('team.createError'));
      return;
    }

    const link = `${window.location.origin}/accept-invite/${token}`;
    setCreatedLink(link);
    setInviteEmail('');
    setInviteRole('coordinator');
    await reload();
  }, [tenantId, userId, inviteEmail, inviteRole, supabase, t, reload]);

  const handleRevoke = useCallback(async (id: string) => {
    if (!window.confirm(t('team.revokeConfirm'))) return;
    await supabase.from('team_invitations').delete().eq('id', id);
    await reload();
  }, [supabase, t, reload]);

  const handleCopy = useCallback(async () => {
    if (!createdLink) return;
    await navigator.clipboard.writeText(createdLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [createdLink]);

  if (!isAdmin) {
    return (
      <div className="p-8 text-sm text-sc-text-muted">{t('team.noPermission')}</div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-sc-text">{t('team.pageTitle')}</h1>
          <p className="mt-1 text-sm text-sc-text-muted">{t('team.pageIntro')}</p>
        </div>
        <button
          type="button"
          onClick={() => { setDialogOpen(true); setCreatedLink(null); setCreateError(null); }}
          className="rounded-xl bg-sc-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sc-primary/20 hover:bg-sc-primary-deep"
        >
          {t('team.inviteButton')}
        </button>
      </div>

      {/* ── Dialog invito ──────────────────────────────────────────────────── */}
      {dialogOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-dialog-title"
          className="mb-6 rounded-2xl border border-sc-primary/15 bg-sc-surface p-5 shadow-xl"
        >
          <h2 id="invite-dialog-title" className="mb-4 text-base font-semibold text-sc-text">
            {t('team.inviteDialogTitle')}
          </h2>

          {createdLink ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-sc-text">{t('team.inviteSuccessTitle')}</p>
              <p className="text-sm text-sc-text-muted">{t('team.inviteSuccessBody')}</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={createdLink}
                  className="flex-1 rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 text-xs text-sc-text-dim outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="rounded-xl border border-sc-primary/30 px-3 py-2 text-xs font-medium text-sc-primary hover:bg-sc-primary/8"
                >
                  {copied ? t('team.linkCopied') : t('team.copyLink')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="text-sm text-sc-text-dim hover:text-sc-text"
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="inv-email" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                  {t('team.inviteEmailLabel')}
                </label>
                <input
                  id="inv-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('team.inviteEmailPlaceholder')}
                  className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors placeholder:text-sc-text-dim focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                />
              </div>
              <div>
                <label htmlFor="inv-role" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                  {t('team.inviteRoleLabel')}
                </label>
                <select
                  id="inv-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                  className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                >
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{t(`role.${r}`)}</option>
                  ))}
                </select>
              </div>
              {createError ? (
                <p className="text-sm text-sc-danger" role="alert">{createError}</p>
              ) : null}
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={creating || !inviteEmail.trim()}
                  onClick={() => void handleCreate()}
                  className="rounded-xl bg-sc-primary px-4 py-2 text-sm font-semibold text-white hover:bg-sc-primary-deep disabled:opacity-50"
                >
                  {t('team.inviteSubmit')}
                </button>
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-xl border border-sc-primary/15 px-4 py-2 text-sm text-sc-text-muted hover:bg-sc-primary/8"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Lista inviti ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sc-text-muted">
          {t('team.pendingTitle')}
        </h2>
        {loading ? (
          <p className="text-sm text-sc-text-dim">{t('common.loading')}</p>
        ) : loadError ? (
          <p className="text-sm text-sc-danger">{loadError}</p>
        ) : invites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sc-primary/25 bg-sc-surface/40 p-6 text-center">
            <h3 className="text-base font-semibold text-sc-text">{t('emptyState.teamTitle')}</h3>
            <p className="mt-2 mx-auto max-w-md text-sm text-sc-text-muted">{t('emptyState.teamBody')}</p>
            <button
              type="button"
              onClick={() => { setDialogOpen(true); setCreatedLink(null); setCreateError(null); }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-sc-primary/85"
            >
              {t('team.inviteButton')}
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-sc-primary/8 rounded-2xl border border-sc-primary/12 bg-sc-surface">
            {invites.map((inv) => {
              const st = inviteStatus(inv);
              return (
                <li key={inv.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-sc-text">{inv.email}</p>
                    <p className="text-xs text-sc-text-dim">
                      {t(`role.${inv.role}`)} · {t('team.colExpiry')}: {dateFmt.format(new Date(inv.invite_token_expires_at))}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={st} />
                    {st === 'pending' ? (
                      <button
                        type="button"
                        onClick={() => void handleRevoke(inv.id)}
                        className="rounded-md border border-red-700/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/40"
                      >
                        {t('team.revokeButton')}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: 'accepted' | 'expired' | 'pending' }) {
  const { t } = useTranslation();
  const cls = {
    accepted: 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300',
    expired: 'border-zinc-700 bg-zinc-900 text-zinc-500',
    pending: 'border-blue-700/60 bg-blue-950/40 text-blue-300',
  }[status];
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {t(`team.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
    </span>
  );
}

export { TeamView as Component };
