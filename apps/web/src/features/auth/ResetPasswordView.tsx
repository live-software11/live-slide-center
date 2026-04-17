import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { AppBrandLogo } from '@/components/AppBrandLogo';

function schema(t: (k: string, o?: Record<string, unknown>) => string) {
  return z
    .object({
      password: z.string().min(8, t('validation.minLength', { min: 8 })),
      confirmPassword: z.string().min(1, t('validation.required')),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t('auth.resetPasswordErrorMismatch'),
      path: ['confirmPassword'],
    });
}

type FormValues = z.infer<ReturnType<typeof schema>>;

export default function ResetPasswordView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const resolvedSchema = useMemo(() => schema(t), [t]);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Supabase invia il recovery token come fragment (#access_token=...&type=recovery).
  // onAuthStateChange intercetta l'evento PASSWORD_RECOVERY e stabilisce la sessione.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    // Fallback: se la sessione è già presente (tab già autenticata col recovery token)
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    // Timeout: se dopo 5s non arriva l'evento, il link non era valido
    const timer = setTimeout(() => {
      setSessionError((prev) => {
        if (!prev) return true;
        return prev;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [supabase]);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(resolvedSchema),
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setSubmitError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitError(t('auth.errorGeneric'));
      return;
    }
    setSuccess(true);
    setTimeout(() => void navigate('/', { replace: true }), 2000);
  });

  // Aspetta evento o sessione
  if (!sessionReady && !sessionError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg text-sc-text-muted">
        {t('auth.loadingSession')}
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
            {t('auth.resetPasswordPageTitle')}
          </h1>
        </div>
        <div className="rounded-2xl border border-sc-primary/12 bg-sc-surface p-6 shadow-xl shadow-sc-primary/5">
          {sessionError && !sessionReady ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-sc-danger">{t('auth.resetPasswordErrorSession')}</p>
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-sc-primary hover:underline"
              >
                {t('auth.forgotPasswordSubmit')}
              </Link>
            </div>
          ) : success ? (
            <p className="text-sm text-sc-text">{t('auth.resetPasswordSuccess')}</p>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="rp-password" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                  {t('auth.resetPasswordLabel')}
                </label>
                <input
                  id="rp-password"
                  type="password"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                  aria-invalid={errors.password ? true : undefined}
                  {...register('password')}
                />
                {errors.password ? (
                  <p className="mt-1.5 text-xs text-sc-danger" role="alert">{errors.password.message}</p>
                ) : null}
              </div>
              <div>
                <label htmlFor="rp-confirm" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                  {t('auth.resetPasswordConfirmLabel')}
                </label>
                <input
                  id="rp-confirm"
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
                {t('auth.resetPasswordSubmit')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export { ResetPasswordView as Component };
