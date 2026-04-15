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
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        {t('auth.loadingSession')}
      </div>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  if (awaitingEmailConfirm) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <div
          className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
          role="status"
          aria-live="polite"
          aria-labelledby="signup-email-sent-title"
        >
          <h1 className="text-xl font-semibold tracking-tight" id="signup-email-sent-title">
            {t('auth.signupCheckEmailTitle')}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">{t('auth.signupCheckEmailBody')}</p>
          <p className="mt-6">
            <Link
              to="/login"
              className="text-sm font-medium text-blue-500 hover:text-blue-400 hover:underline"
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <h1 className="text-xl font-semibold tracking-tight" id="signup-title">
          {t('auth.signupPageTitle')}
        </h1>
        <p className="sr-only">{t('auth.a11ySignupTitle')}</p>
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="signup-fullname" className="mb-1 block text-sm text-zinc-400">
              {t('auth.fullName')}
            </label>
            <input
              id="signup-fullname"
              type="text"
              autoComplete="organization"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={errors.fullName ? 'signup-fullname-err' : undefined}
              {...register('fullName')}
            />
            {errors.fullName ? (
              <p id="signup-fullname-err" className="mt-1 text-xs text-red-400" role="alert">
                {errors.fullName.message}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="signup-email" className="mb-1 block text-sm text-zinc-400">
              {t('auth.email')}
            </label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'signup-email-err' : undefined}
              {...register('email')}
            />
            {errors.email ? (
              <p id="signup-email-err" className="mt-1 text-xs text-red-400" role="alert">
                {errors.email.message}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="signup-password" className="mb-1 block text-sm text-zinc-400">
              {t('auth.password')}
            </label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'signup-password-err' : undefined}
              {...register('password')}
            />
            {errors.password ? (
              <p id="signup-password-err" className="mt-1 text-xs text-red-400" role="alert">
                {errors.password.message}
              </p>
            ) : null}
          </div>
          {submitError ? (
            <p className="text-sm text-red-400" role="alert">
              {submitError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {t('auth.submitSignup')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          <Link to="/login" className="text-blue-500 hover:underline">
            {t('auth.goToLogin')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export { SignupView as Component };
