import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { AppBrandLogo } from '@/components/AppBrandLogo';

type InviteInfo = {
  email: string;
  role: string;
  tenant_name: string;
  expires_at: string;
};

type ValidateState =
  | { status: 'loading' }
  | { status: 'valid'; info: InviteInfo }
  | { status: 'invalid'; error: string };

function schema(t: (k: string, o?: Record<string, unknown>) => string) {
  return z
    .object({
      full_name: z.string().min(1, t('validation.required')),
      password: z.string().min(8, t('validation.minLength', { min: 8 })),
      confirmPassword: z.string().min(1, t('validation.required')),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t('auth.resetPasswordErrorMismatch'),
      path: ['confirmPassword'],
    });
}

type FormValues = z.infer<ReturnType<typeof schema>>;

export default function AcceptInviteView() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const resolvedSchema = useMemo(() => schema(t), [t]);

  // Stato inizializzato lazy: se il token manca, partiamo già da invalid (evita setState sync in effect)
  const [validateState, setValidateState] = useState<ValidateState>(
    () => (token ? { status: 'loading' } : { status: 'invalid', error: 'not_found' }),
  );
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Valida il token chiamando l'Edge Function (solo se token è presente)
  useEffect(() => {
    if (!token) return;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    void fetch(`${supabaseUrl}/functions/v1/team-invite-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ action: 'validate', token }),
    })
      .then((r) => r.json())
      .then((data: { valid?: boolean; error?: string; email?: string; role?: string; tenant_name?: string; expires_at?: string }) => {
        if (data.valid && data.email) {
          setValidateState({
            status: 'valid',
            info: {
              email: data.email,
              role: data.role ?? '',
              tenant_name: data.tenant_name ?? '',
              expires_at: data.expires_at ?? '',
            },
          });
        } else {
          setValidateState({ status: 'invalid', error: data.error ?? 'invalid' });
        }
      })
      .catch(() => setValidateState({ status: 'invalid', error: 'invalid' }));
  }, [token]);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(resolvedSchema),
  });

  const onSubmit = handleSubmit(async ({ full_name, password }) => {
    if (!token) return;
    setSubmitError(null);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const res = await fetch(`${supabaseUrl}/functions/v1/team-invite-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ action: 'accept', token, password, full_name }),
    });

    const data = await res.json() as { ok?: boolean; error?: string };

    if (!res.ok || !data.ok) {
      const err = data.error ?? 'generic';
      setSubmitError(
        err === 'email_already_registered'
          ? t('auth.acceptInviteErrorEmailExists')
          : t('auth.acceptInviteErrorGeneric'),
      );
      return;
    }

    setSuccess(true);

    // Accedi automaticamente dopo la creazione
    if (validateState.status === 'valid') {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: validateState.info.email,
        password,
      });
      if (!signInErr) {
        setTimeout(() => void navigate('/', { replace: true }), 1000);
      }
    }
  });

  // ── Caricamento ────────────────────────────────────────────────────────────
  if (validateState.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg text-sc-text-muted">
        {t('auth.acceptInviteLoading')}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-sc-bg px-4 text-sc-text">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-80 w-[600px] -translate-x-1/2 rounded-full bg-sc-primary/8 blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex items-center gap-3">
            <AppBrandLogo size="lg" className="shrink-0" />
            <p className="text-left text-lg font-bold leading-tight tracking-tight text-sc-text">
              {t('app.displayName')}
            </p>
          </div>
          <h1 className="mt-3 text-base font-medium text-sc-text-muted">
            {t('auth.acceptInvitePageTitle')}
          </h1>
        </div>
        <div className="rounded-2xl border border-sc-primary/12 bg-sc-surface p-6 shadow-xl shadow-sc-primary/5">
          {/* ── Token non valido ────────────────────────────────────────── */}
          {validateState.status === 'invalid' ? (
            <p className="text-sm text-sc-danger">
              {validateState.error === 'expired'
                ? t('auth.acceptInviteExpired')
                : validateState.error === 'already_used'
                  ? t('auth.acceptInviteAlreadyUsed')
                  : t('auth.acceptInviteInvalid')}
            </p>
          ) : success ? (
            /* ── Successo ──────────────────────────────────────────────── */
            <p className="text-sm text-sc-text">{t('auth.acceptInviteSuccess')}</p>
          ) : (
            /* ── Form creazione account ─────────────────────────────────── */
            <>
              <p className="mb-4 text-sm text-sc-text-muted">
                {t('auth.acceptInviteSubtitle', {
                  role: validateState.info.role,
                  tenant: validateState.info.tenant_name,
                })}
              </p>
              <p className="mb-4 text-xs text-sc-text-dim">
                {validateState.info.email}
              </p>
              <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
                <div>
                  <label htmlFor="ai-name" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                    {t('auth.acceptInviteFullNameLabel')}
                  </label>
                  <input
                    id="ai-name"
                    type="text"
                    autoComplete="name"
                    placeholder={t('auth.acceptInviteFullNamePlaceholder')}
                    className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors placeholder:text-sc-text-dim focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                    aria-invalid={errors.full_name ? true : undefined}
                    {...register('full_name')}
                  />
                  {errors.full_name ? (
                    <p className="mt-1.5 text-xs text-sc-danger" role="alert">{errors.full_name.message}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="ai-password" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                    {t('auth.acceptInvitePasswordLabel')}
                  </label>
                  <input
                    id="ai-password"
                    type="password"
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                    aria-invalid={errors.password ? true : undefined}
                    {...register('password')}
                  />
                  {errors.password ? (
                    <p className="mt-1.5 text-xs text-sc-danger" role="alert">{errors.password.message}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-sc-text-dim">{t('auth.acceptInvitePasswordHint')}</p>
                </div>
                <div>
                  <label htmlFor="ai-confirm" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                    {t('auth.acceptInviteConfirmPasswordLabel')}
                  </label>
                  <input
                    id="ai-confirm"
                    type="password"
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                    aria-invalid={errors.confirmPassword ? true : undefined}
                    {...register('confirmPassword')}
                  />
                  {errors.confirmPassword ? (
                    <p className="mt-1.5 text-xs text-sc-danger" role="alert">{errors.confirmPassword.message}</p>
                  ) : null}
                </div>
                {submitError ? (
                  <p className="text-sm text-sc-danger" role="alert">{submitError}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-sc-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sc-primary/20 transition-all hover:bg-sc-primary-deep disabled:opacity-50"
                >
                  {t('auth.acceptInviteSubmit')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { AcceptInviteView as Component };
