import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getTenantIdFromUser } from '@/lib/session-tenant';

function loginSchema(t: (key: string, opts?: Record<string, unknown>) => string) {
  return z.object({
    email: z.string().min(1, t('validation.required')).email(t('validation.emailInvalid')),
    password: z.string().min(8, t('validation.minLength', { min: 8 })),
  });
}

type FormValues = z.infer<ReturnType<typeof loginSchema>>;

export default function LoginView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const resolvedSchema = useMemo(() => loginSchema(t), [t]);

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

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setSubmitError(
        error.message.toLowerCase().includes('invalid')
          ? t('auth.errorInvalidCredentials')
          : t('auth.errorGeneric'),
      );
      return;
    }
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      setSubmitError(t('auth.errorLoginRefresh'));
      await supabase.auth.signOut();
      return;
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setSubmitError(t('auth.errorLoginRefresh'));
      await supabase.auth.signOut();
      return;
    }
    const isSuperAdmin = userData.user.app_metadata?.role === 'super_admin';
    if (!isSuperAdmin && !getTenantIdFromUser(userData.user)) {
      setSubmitError(t('auth.errorTenantMissingLogin'));
      await supabase.auth.signOut();
      return;
    }
    navigate('/', { replace: true });
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <h1 className="text-xl font-semibold tracking-tight" id="login-title">
          {t('auth.loginPageTitle')}
        </h1>
        <p className="sr-only">{t('auth.a11yLoginTitle')}</p>
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="login-email" className="mb-1 block text-sm text-zinc-400">
              {t('auth.email')}
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'login-email-err' : undefined}
              {...register('email')}
            />
            {errors.email ? (
              <p id="login-email-err" className="mt-1 text-xs text-red-400" role="alert">
                {errors.email.message}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm text-zinc-400">
              {t('auth.password')}
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'login-password-err' : undefined}
              {...register('password')}
            />
            {errors.password ? (
              <p id="login-password-err" className="mt-1 text-xs text-red-400" role="alert">
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
            {t('auth.submitLogin')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          <Link to="/signup" className="text-blue-500 hover:underline">
            {t('auth.goToSignup')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export { LoginView as Component };
