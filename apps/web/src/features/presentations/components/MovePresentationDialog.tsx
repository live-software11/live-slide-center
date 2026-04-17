import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { movePresentation } from '@/features/presentations/repository';

// Modal di scelta speaker target per spostare una presentation.
// `availableSpeakers` deve essere una lista filtrata: stesso evento,
// escluso lo speaker corrente, escluso chi ha gia una presentation.

export interface MoveTargetSpeaker {
  id: string;
  full_name: string;
  session_title: string;
}

interface MovePresentationDialogProps {
  presentationId: string;
  currentSpeakerName: string;
  availableSpeakers: MoveTargetSpeaker[];
  onClose: () => void;
  onMoved: (result: { speakerId: string; sessionId: string }) => void;
}

const MOVE_ERROR_MAP: Record<string, string> = {
  target_speaker_has_presentation: 'presentation.move.errorTargetHasPresentation',
  cross_event_move_not_allowed: 'presentation.move.errorCrossEvent',
  same_speaker_no_op: 'presentation.move.errorSameSpeaker',
  presentation_not_found_or_cross_tenant: 'presentation.move.errorNotFound',
  target_speaker_not_found_or_cross_tenant: 'presentation.move.errorTargetNotFound',
  no_tenant_in_jwt: 'presentation.move.errorTenantMissing',
  role_forbidden: 'presentation.move.errorRoleForbidden',
  tenant_suspended: 'presentation.move.errorTenantSuspended',
  event_closed_or_archived: 'presentation.move.errorEventClosed',
  presentation_archived: 'presentation.move.errorPresentationArchived',
};

export function MovePresentationDialog({
  presentationId,
  currentSpeakerName,
  availableSpeakers,
  onClose,
  onMoved,
}: MovePresentationDialogProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedSpeakers = useMemo(
    () => [...availableSpeakers].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [availableSpeakers],
  );

  const handleSubmit = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await movePresentation(presentationId, target);
      onMoved({ speakerId: res.speaker_id, sessionId: res.session_id });
      onClose();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? '';
      const key = Object.entries(MOVE_ERROR_MAP).find(([code]) => msg.includes(code))?.[1];
      setError(key ?? 'presentation.move.errorGeneric');
    } finally {
      setBusy(false);
    }
  }, [onClose, onMoved, presentationId, target]);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-presentation-title"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-sc-primary/20 bg-sc-surface p-5 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t('common.close')}
          className="absolute right-3 top-3 rounded-xl p-1 text-sc-text-muted hover:text-sc-text disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="move-presentation-title" className="mb-1 text-base font-semibold text-white">
          {t('presentation.move.dialogTitle')}
        </h2>
        <p className="mb-4 text-xs text-sc-text-muted">
          {t('presentation.move.dialogIntro', { name: currentSpeakerName })}
        </p>

        <label className="mb-1 block text-xs font-medium text-sc-text-secondary" htmlFor="move-target">
          {t('presentation.move.targetSpeakerLabel')}
        </label>
        <select
          id="move-target"
          className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none ring-sc-ring/25 focus:ring-2 disabled:opacity-50"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy || sortedSpeakers.length === 0}
        >
          <option value="">{t('presentation.move.selectSpeakerPlaceholder')}</option>
          {sortedSpeakers.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.full_name} — {sp.session_title}
            </option>
          ))}
        </select>

        {sortedSpeakers.length === 0 ? (
          <p className="mt-3 rounded border border-sc-warning/30 bg-sc-warning/10 px-3 py-2 text-xs text-sc-warning">
            {t('presentation.move.noTargetsAvailable')}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded border border-sc-danger/20 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger">
            {t(error)}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text hover:bg-sc-elevated disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !target}
            onClick={() => void handleSubmit()}
            className="inline-flex items-center gap-2 rounded-xl bg-sc-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {busy ? t('presentation.move.moving') : t('presentation.move.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
