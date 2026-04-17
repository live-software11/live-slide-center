import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { AppBrandLogo } from '@/components/AppBrandLogo';

function schema(t: (k: string, o?: Record<string, unknown>) => string) {
  return z.object({
    email: z.string().min(1, t('validation.required')).email(t('validation.emailInvalid')),
  });
}

type FormValues = z.infer<ReturnType<typeof schema>>;

export default function ForgotPasswordView() {
  const { t } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const resolvedSchema = useMemo(() => schema(t), [t]);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(resolvedSchema),
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setSubmitError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setSubmitError(t('auth.errorGeneric'));
      return;
    }
    setSent(true);
  });

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
            {t('auth.forgotPasswordPageTitle')}
          </h1>
        </div>

        <div className="rounded-2xl border border-sc-primary/12 bg-sc-surface p-6 shadow-xl shadow-sc-primary/5">
          {sent ? (
            <p className="text-sm text-sc-text">{t('auth.forgotPasswordSuccess')}</p>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="fp-email" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                  {t('auth.forgotPasswordLabel')}
                </label>
                <input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors placeholder:text-sc-text-dim focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                  aria-invalid={errors.email ? true : undefined}
                  {...register('email')}
                />
                {errors.email ? (
                  <p className="mt-1.5 text-xs text-sc-danger" role="alert">{errors.email.message}</p>
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
                {t('auth.forgotPasswordSubmit')}
              </button>
            </form>
          )}
          <p className="mt-5 text-center text-sm text-sc-text-dim">
            <Link to="/login" className="font-medium text-sc-primary hover:text-sc-primary-deep hover:underline">
              {t('auth.forgotPasswordBack')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export { ForgotPasswordView as Component };
