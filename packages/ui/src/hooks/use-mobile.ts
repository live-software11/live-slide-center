import * as React from 'react';

const MOBILE_BREAKPOINT = 1024;

export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < breakpoint);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return isMobile;
}
