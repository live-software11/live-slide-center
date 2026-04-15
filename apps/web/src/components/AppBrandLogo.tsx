const LOGO_PUBLIC_PATH = '/logo-live-slide-center.jpg';

type LogoSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<LogoSize, string> = {
  sm: 'h-8 w-8 min-h-8 min-w-8',
  md: 'h-10 w-10 min-h-10 min-w-10',
  lg: 'h-14 w-14 min-h-14 min-w-14',
};

const sizePx: Record<LogoSize, number> = {
  sm: 32,
  md: 40,
  lg: 56,
};

/** Logo prodotto (file in `public/logo-live-slide-center.jpg`, generato dallo script brand). */
export function AppBrandLogo({
  size = 'md',
  className = '',
  alt,
}: {
  size?: LogoSize;
  className?: string;
  /** Se omesso e decorativo, usare stringa vuota con testo vicino. */
  alt?: string;
}) {
  const px = sizePx[size];
  return (
    <img
      src={LOGO_PUBLIC_PATH}
      alt={alt ?? ''}
      width={px}
      height={px}
      decoding="async"
      className={`rounded-xl object-cover shadow-sm ring-1 ring-white/10 ${sizeClasses[size]} ${className}`}
    />
  );
}
