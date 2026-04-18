import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Monitor, Tv2 } from 'lucide-react';
import { setDesktopRole, type NodeRole } from '@/lib/desktop-bridge';

/**
 * Sprint L1 (GUIDA_OPERATIVA_v3 §4.D L1) — schermata di scelta ruolo per la
 * versione desktop di Live SLIDE CENTER.
 *
 * Mostrata UNA SOLA VOLTA al primo avvio, quando `~/SlideCenter/role.json` non
 * esiste. Le due scelte:
 *
 *   • ADMIN — questo PC e' il "centro di controllo": dashboard completa,
 *             SQLite/storage di verita', gestisce eventi/sale/sessioni e
 *             accetta i pairing dei PC sala (LAN).
 *
 *   • PC SALA — questo PC sta in sala riunioni / aula e proietta i file. Riceve
 *               i file dall'admin LAN. UI ridotta a PairView/RoomPlayerView.
 *
 * La scelta puo' essere modificata da Settings (in arrivo) o cancellando il file
 * `~/SlideCenter/role.json` manualmente.
 *
 * Dopo la conferma serve un riavvio del processo Tauri (server + mDNS leggono
 * il ruolo solo al boot). La schermata mostra un messaggio "Riavvia l'app".
 */
export function RoleSelectionView({ onChosen }: { onChosen: (role: NodeRole) => void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<NodeRole | null>(null);
  const [done, setDone] = useState<NodeRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (role: NodeRole) => {
    setError(null);
    setPending(role);
    try {
      await setDesktopRole(role);
      setDone(role);
      onChosen(role);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  if (done) {
    return (
      <div
        className="fixed inset-0 z-100 flex items-center justify-center bg-sc-bg px-6"
        role="dialog"
        aria-labelledby="role-restart-title"
        aria-modal="true"
      >
        <div className="w-full max-w-md rounded-2xl border border-sc-success/30 bg-sc-surface p-8 shadow-2xl">
          <h1 id="role-restart-title" className="text-xl font-semibold text-sc-success">
            {t('desktopRole.restart.title')}
          </h1>
          <p className="mt-3 text-sm text-sc-text-secondary">
            {t(done === 'admin' ? 'desktopRole.restart.adminBody' : 'desktopRole.restart.salaBody')}
          </p>
          <p className="mt-4 text-xs text-sc-text-dim">{t('desktopRole.restart.hint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-sc-bg px-6"
      role="dialog"
      aria-labelledby="role-selection-title"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-sc-primary/20 bg-sc-surface p-8 shadow-2xl">
        <h1 id="role-selection-title" className="text-2xl font-semibold text-white">
          {t('desktopRole.title')}
        </h1>
        <p className="mt-2 text-sm text-sc-text-secondary">{t('desktopRole.subtitle')}</p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RoleCard
            role="admin"
            title={t('desktopRole.admin.title')}
            body={t('desktopRole.admin.body')}
            icon={<Monitor className="h-7 w-7 text-sc-primary" aria-hidden />}
            pending={pending === 'admin'}
            disabled={pending !== null}
            onClick={() => void choose('admin')}
          />
          <RoleCard
            role="sala"
            title={t('desktopRole.sala.title')}
            body={t('desktopRole.sala.body')}
            icon={<Tv2 className="h-7 w-7 text-sc-success" aria-hidden />}
            pending={pending === 'sala'}
            disabled={pending !== null}
            onClick={() => void choose('sala')}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-sm text-sc-danger"
          >
            {error}
          </p>
        ) : null}

        <p className="mt-6 text-xs text-sc-text-dim">{t('desktopRole.changeLater')}</p>
      </div>
    </div>
  );
}

interface RoleCardProps {
  role: NodeRole;
  title: string;
  body: string;
  icon: React.ReactNode;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}

function RoleCard({ role, title, body, icon, pending, disabled, onClick }: RoleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-role={role}
      className="group flex flex-col items-start gap-3 rounded-xl border border-sc-primary/20 bg-sc-bg/60 p-5 text-left transition hover:border-sc-primary/60 hover:bg-sc-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-sc-primary disabled:cursor-wait disabled:opacity-60"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-sc-elevated p-2">{icon}</div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      <p className="text-sm text-sc-text-secondary">{body}</p>
      {pending ? (
        <div className="mt-2 inline-flex items-center gap-2 text-xs text-sc-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>…</span>
        </div>
      ) : null}
    </button>
  );
}
