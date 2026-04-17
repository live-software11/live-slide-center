import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CheckCircle2, ChevronLeft, ChevronRight, PartyPopper, Rocket, Sparkles, Users, X } from 'lucide-react';
import { markTenantOnboarded, seedDemoData } from '../repository';

type Step = 1 | 2 | 3;

type Props = {
  supabase: SupabaseClient;
  tenantId: string;
  tenantName: string;
  /** Chiamato a wizard chiuso (mark_tenant_onboarded eseguito o forced skip). */
  onClose: () => void;
};

type EventForm = {
  name: string;
  start_date: string;
  end_date: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function OnboardingWizard({ supabase, tenantId, tenantName, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const [seedResult, setSeedResult] = useState<{ event_id: string; created: boolean } | null>(null);

  const [eventForm, setEventForm] = useState<EventForm>({
    name: '',
    start_date: todayIsoDate(),
    end_date: todayIsoDate(),
  });

  const closeWizard = useCallback(
    async (markOnboarded: boolean) => {
      setSubmitting(true);
      setError(null);
      try {
        if (markOnboarded) {
          await markTenantOnboarded(supabase);
        }
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown_error';
        setError(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [onClose, supabase],
  );

  const handleSkipAll = useCallback(() => {
    void closeWizard(true);
  }, [closeWizard]);

  const handleNext = useCallback(() => {
    setError(null);
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
  }, [step]);

  const handleBack = useCallback(() => {
    setError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }, [step]);

  const handleCreateEvent = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = eventForm.name.trim();
      if (trimmed.length < 2) {
        setError(t('onboarding.errors.nameTooShort'));
        return;
      }
      if (eventForm.start_date > eventForm.end_date) {
        setError(t('onboarding.errors.dateOrder'));
        return;
      }
      const { data, error: rpcError } = await supabase
        .from('events')
        .insert({
          name: trimmed,
          start_date: eventForm.start_date,
          end_date: eventForm.end_date,
          tenant_id: tenantId,
          status: 'setup',
        })
        .select('id')
        .single();
      if (rpcError) throw rpcError;
      if (!data) throw new Error('insert_returned_no_id');
      setCreatedEventId(data.id);
      setStep(3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'create_event_error';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [eventForm, supabase, t, tenantId]);

  const handleSeedDemo = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await seedDemoData(supabase);
      setSeedResult({ event_id: res.event_id, created: res.created });
      setStep(3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'seed_demo_error';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [supabase]);

  const handleFinish = useCallback(async () => {
    await closeWizard(true);
    const targetEventId = createdEventId ?? seedResult?.event_id;
    if (targetEventId) {
      navigate(`/events/${targetEventId}`);
    }
  }, [closeWizard, createdEventId, navigate, seedResult]);

  const stepLabel = useMemo(
    () => t('onboarding.stepIndicator', { current: step, total: 3 }),
    [step, t],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-wizard-title"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-sc-primary/20 bg-sc-bg shadow-2xl">
        <div className="flex items-start justify-between border-b border-sc-primary/12 bg-sc-surface/60 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sc-primary/15 text-sc-primary">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 id="onboarding-wizard-title" className="text-lg font-semibold text-sc-text">
                {t('onboarding.title', { tenantName })}
              </h2>
              <p className="mt-0.5 text-xs text-sc-text-muted">{stepLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSkipAll}
            disabled={submitting}
            className="rounded-lg p-2 text-sc-text-muted transition-colors hover:bg-sc-primary/8 hover:text-sc-text disabled:opacity-50"
            aria-label={t('onboarding.skipAll')}
            title={t('onboarding.skipAll')}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-sc-primary/10 bg-sc-bg/40 px-6 py-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                n <= step ? 'bg-sc-primary' : 'bg-sc-primary/15'
              }`}
              aria-hidden
            />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === 1 ? <StepWelcome /> : null}
          {step === 2 ? (
            <StepEvent
              eventForm={eventForm}
              setEventForm={setEventForm}
              submitting={submitting}
              onCreate={handleCreateEvent}
              onSeedDemo={handleSeedDemo}
            />
          ) : null}
          {step === 3 ? (
            <StepFinish
              createdEventId={createdEventId}
              seedResult={seedResult}
            />
          ) : null}
          {error ? (
            <p className="mt-4 rounded-xl border border-sc-danger/25 bg-sc-danger/10 p-3 text-sm text-sc-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sc-primary/12 bg-sc-surface/60 px-6 py-4">
          <button
            type="button"
            onClick={handleSkipAll}
            disabled={submitting}
            className="text-xs text-sc-text-dim hover:text-sc-text-muted disabled:opacity-50"
          >
            {t('onboarding.skipAll')}
          </button>
          <div className="flex items-center gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sc-primary/20 px-4 py-2 text-sm font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/8 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                {t('onboarding.back')}
              </button>
            ) : null}
            {step === 1 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sc-primary/85 disabled:opacity-50"
              >
                {t('onboarding.next')}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            {step === 3 ? (
              <button
                type="button"
                onClick={() => void handleFinish()}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sc-primary/85 disabled:opacity-50"
              >
                {submitting ? t('common.loading') : t('onboarding.finish')}
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepWelcome() {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-start gap-3">
        <PartyPopper className="h-7 w-7 shrink-0 text-sc-accent" aria-hidden />
        <div>
          <h3 className="text-xl font-semibold text-sc-text">{t('onboarding.welcomeTitle')}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sc-text-muted">
            {t('onboarding.welcomeBody')}
          </p>
        </div>
      </div>
      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        <li className="rounded-xl border border-sc-primary/15 bg-sc-surface/40 p-4">
          <div className="text-sc-primary">
            <Rocket className="h-5 w-5" aria-hidden />
          </div>
          <h4 className="mt-2 text-sm font-semibold text-sc-text">{t('onboarding.benefit1Title')}</h4>
          <p className="mt-1 text-xs leading-relaxed text-sc-text-muted">{t('onboarding.benefit1Body')}</p>
        </li>
        <li className="rounded-xl border border-sc-primary/15 bg-sc-surface/40 p-4">
          <div className="text-sc-primary">
            <Users className="h-5 w-5" aria-hidden />
          </div>
          <h4 className="mt-2 text-sm font-semibold text-sc-text">{t('onboarding.benefit2Title')}</h4>
          <p className="mt-1 text-xs leading-relaxed text-sc-text-muted">{t('onboarding.benefit2Body')}</p>
        </li>
        <li className="rounded-xl border border-sc-primary/15 bg-sc-surface/40 p-4">
          <div className="text-sc-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <h4 className="mt-2 text-sm font-semibold text-sc-text">{t('onboarding.benefit3Title')}</h4>
          <p className="mt-1 text-xs leading-relaxed text-sc-text-muted">{t('onboarding.benefit3Body')}</p>
        </li>
      </ul>
    </div>
  );
}

function StepEvent({
  eventForm,
  setEventForm,
  submitting,
  onCreate,
  onSeedDemo,
}: {
  eventForm: EventForm;
  setEventForm: (v: EventForm) => void;
  submitting: boolean;
  onCreate: () => Promise<void>;
  onSeedDemo: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-sc-primary/15 bg-sc-surface/40 p-5">
        <h3 className="text-base font-semibold text-sc-text">{t('onboarding.createEventTitle')}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-sc-text-muted">
          {t('onboarding.createEventBody')}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-sc-text-muted">
            {t('event.name')}
            <input
              type="text"
              value={eventForm.name}
              onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
              disabled={submitting}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none ring-sc-ring/25 focus:border-sc-primary/40 focus:ring-2 disabled:opacity-50"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-sc-text-muted">
              {t('event.startDate')}
              <input
                type="date"
                value={eventForm.start_date}
                onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })}
                disabled={submitting}
                className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none ring-sc-ring/25 focus:border-sc-primary/40 focus:ring-2 disabled:opacity-50"
              />
            </label>
            <label className="text-xs text-sc-text-muted">
              {t('event.endDate')}
              <input
                type="date"
                value={eventForm.end_date}
                onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                disabled={submitting}
                className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none ring-sc-ring/25 focus:border-sc-primary/40 focus:ring-2 disabled:opacity-50"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={submitting || eventForm.name.trim().length < 2}
            className="mt-2 inline-flex items-center justify-center rounded-xl bg-sc-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sc-primary/85 disabled:opacity-50"
          >
            {submitting ? t('common.loading') : t('onboarding.createEventCta')}
          </button>
        </div>
      </section>

      <section className="flex flex-col rounded-xl border border-sc-accent/20 bg-sc-accent/8 p-5">
        <h3 className="text-base font-semibold text-sc-text">{t('onboarding.demoTitle')}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-sc-text-muted">
          {t('onboarding.demoBody')}
        </p>
        <ul className="mt-4 list-inside list-disc space-y-1 text-xs text-sc-text-muted">
          <li>{t('onboarding.demoBullet1')}</li>
          <li>{t('onboarding.demoBullet2')}</li>
          <li>{t('onboarding.demoBullet3')}</li>
        </ul>
        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={() => void onSeedDemo()}
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-xl border border-sc-accent/40 bg-sc-accent/10 px-4 py-2.5 text-sm font-medium text-sc-accent transition-colors hover:bg-sc-accent/15 disabled:opacity-50"
          >
            {submitting ? t('common.loading') : t('onboarding.demoCta')}
          </button>
        </div>
      </section>
    </div>
  );
}

function StepFinish({
  createdEventId,
  seedResult,
}: {
  createdEventId: string | null;
  seedResult: { event_id: string; created: boolean } | null;
}) {
  const { t } = useTranslation();
  const hasCreated = createdEventId !== null;
  const hasDemo = seedResult !== null;
  return (
    <div>
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-7 w-7 shrink-0 text-sc-accent" aria-hidden />
        <div>
          <h3 className="text-xl font-semibold text-sc-text">{t('onboarding.finishTitle')}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sc-text-muted">
            {hasCreated
              ? t('onboarding.finishBodyCreated')
              : hasDemo
                ? seedResult?.created
                  ? t('onboarding.finishBodyDemo')
                  : t('onboarding.finishBodyDemoExisting')
                : t('onboarding.finishBodySkipped')}
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-sc-primary/15 bg-sc-surface/40 p-4">
          <h4 className="text-sm font-semibold text-sc-text">{t('onboarding.nextStepsTeam')}</h4>
          <p className="mt-1.5 text-xs leading-relaxed text-sc-text-muted">{t('onboarding.nextStepsTeamBody')}</p>
        </div>
        <div className="rounded-xl border border-sc-primary/15 bg-sc-surface/40 p-4">
          <h4 className="text-sm font-semibold text-sc-text">{t('onboarding.nextStepsAgent')}</h4>
          <p className="mt-1.5 text-xs leading-relaxed text-sc-text-muted">{t('onboarding.nextStepsAgentBody')}</p>
        </div>
      </div>
    </div>
  );
}
