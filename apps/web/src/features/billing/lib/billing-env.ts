export interface BillingEnvUrls {
  checkoutStarter: string | null;
  checkoutPro: string | null;
  customerPortal: string | null;
  liveWorksApp: string | null;
}

function pickUrl(v: string | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
}

/** URL checkout Lemon Squeezy / portale cliente — configurati in `.env` root (Vite `envDir`). */
export function getBillingEnvUrls(): BillingEnvUrls {
  const e = import.meta.env;
  return {
    checkoutStarter: pickUrl(e.VITE_LEMONSQUEEZY_CHECKOUT_STARTER_URL),
    checkoutPro: pickUrl(e.VITE_LEMONSQUEEZY_CHECKOUT_PRO_URL),
    customerPortal: pickUrl(e.VITE_LEMONSQUEEZY_CUSTOMER_PORTAL_URL),
    liveWorksApp: pickUrl(e.VITE_LIVE_WORKS_APP_URL),
  };
}
