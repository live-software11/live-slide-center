import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

/**
 * Portale pubblico `/u/:token`: stub fino a Fase 3 (TUS + validazione token lato Storage/Edge).
 * Il token resta nel path per bookmark e log futuri; nessuna query anonima al DB in questa versione.
 */
export default function UploadPortalStubView() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  void token;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-400/90">
          {t('uploadPortal.badge')}
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight" id="upload-portal-title">
          {t('uploadPortal.pageTitle')}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">{t('uploadPortal.intro')}</p>
        <p className="mt-6">
          <Link
            to="/login"
            className="text-sm font-medium text-blue-500 hover:text-blue-400 hover:underline"
          >
            {t('uploadPortal.goToLogin')} →
          </Link>
        </p>
      </div>
    </div>
  );
}

export { UploadPortalStubView as Component };
