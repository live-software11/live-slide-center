import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { waitForTenantIdAfterSignup } from './lib/wait-for-tenant-jwt';

function signupSchema(t: (key: string, opts?: Record<string, unknown>) => string) {
  return z.object({
    fullName: z.string().min(2, t('validation.minLength', { min: 2 })).max(200, t('validation.maxLength', { max: 200 })),
    email: z.string().min(1, t('validation.required')).email(t('validation.emailInvalid')),
    password: z.string().min(8, t('validation.minLength', { min: 8 })),
  });
}

type FormValues = z.infer<ReturnType<typeof signupSchema>>;

export default function SignupView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [awaitingEmailConfirm, setAwaitingEmailConfirm] = useState(false);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const resolvedSchema = useMemo(() => signupSchema(t), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(resolvedSchema) });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg text-sc-text-muted">
        {t('auth.loadingSession')}
      </div>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  if (awaitingEmailConfirm) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg px-4 text-sc-text">
        <div
          className="w-full max-w-sm rounded-2xl border border-sc-primary/12 bg-sc-surface p-6 shadow-xl shadow-sc-primary/5"
          role="status"
          aria-live="polite"
          aria-labelledby="signup-email-sent-title"
        >
          <h1 className="text-xl font-semibold tracking-tight" id="signup-email-sent-title">
            {t('auth.signupCheckEmailTitle')}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-sc-text-muted">{t('auth.signupCheckEmailBody')}</p>
          <p className="mt-6">
            <Link
              to="/login"
              className="text-sm font-semibold text-sc-primary hover:text-sc-primary-deep hover:underline"
            >
              {t('auth.signupCheckEmailCta')} →
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { full_name: values.fullName },
      },
    });
    if (error) {
      setSubmitError(t('auth.errorGeneric'));
      return;
    }
    if (!data.session) {
      if (data.user) {
        setAwaitingEmailConfirm(true);
        return;
      }
      setSubmitError(t('auth.errorGeneric'));
      return;
    }
    const jwtReady = await waitForTenantIdAfterSignup(supabase);
    if (!jwtReady.ok) {
      setSubmitError(
        jwtReady.code === 'refresh_failed' ? t('auth.errorSessionRefresh') : t('auth.errorTenantProvisioning'),
      );
      return;
    }
    navigate('/', { replace: true });
  });

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-sc-bg px-4 text-sc-text">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-80 w-[600px] -translate-x-1/2 rounded-full bg-sc-primary/8 blur-3xl" />
        <div className="absolute -top-20 left-1/3 h-60 w-[400px] -translate-x-1/2 rounded-full bg-sc-accent/5 blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sc-navy ring-1 ring-white/10">
            <span className="text-lg font-bold text-sc-primary">SC</span>
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight" id="signup-title">
            {t('auth.signupPageTitle')}
          </h1>
        </div>
        <div className="rounded-2xl border border-sc-primary/12 bg-sc-surface p-6 shadow-xl shadow-sc-primary/5">
          <p className="sr-only">{t('auth.a11ySignupTitle')}</p>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div>
              <label htmlFor="signup-fullname" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                {t('auth.fullName')}
              </label>
              <input
                id="signup-fullname"
                type="text"
                autoComplete="organization"
                className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors placeholder:text-sc-text-dim focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                aria-invalid={errors.fullName ? true : undefined}
                aria-describedby={errors.fullName ? 'signup-fullname-err' : undefined}
                {...register('fullName')}
              />
              {errors.fullName ? (
                <p id="signup-fullname-err" className="mt-1.5 text-xs text-sc-danger" role="alert">
                  {errors.fullName.message}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                {t('auth.email')}
              </label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors placeholder:text-sc-text-dim focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'signup-email-err' : undefined}
                {...register('email')}
              />
              {errors.email ? (
                <p id="signup-email-err" className="mt-1.5 text-xs text-sc-danger" role="alert">
                  {errors.email.message}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-sc-text-muted">
                {t('auth.password')}
              </label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3.5 py-2.5 text-sm text-sc-text outline-none transition-colors placeholder:text-sc-text-dim focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? 'signup-password-err' : undefined}
                {...register('password')}
              />
              {errors.password ? (
                <p id="signup-password-err" className="mt-1.5 text-xs text-sc-danger" role="alert">
                  {errors.password.message}
                </p>
              ) : null}
            </div>
            {submitError ? (
              <p className="text-sm text-sc-danger" role="alert">
                {submitError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-sc-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sc-primary/20 transition-all hover:bg-sc-primary-deep hover:shadow-sc-primary/30 disabled:opacity-50"
            >
              {t('auth.submitSignup')}
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-sc-text-dim">
            <Link to="/login" className="font-medium text-sc-primary hover:text-sc-primary-deep hover:underline">
              {t('auth.goToLogin')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export { SignupView as Component };
