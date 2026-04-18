import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Monitor,
  Network,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Tv,
  Users,
  Wrench,
} from 'lucide-react';
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  Toaster,
  cn,
  useSidebar,
} from '@slidecenter/ui';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getBackendMode } from '@/lib/backend-mode';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import { BackendModeBadge } from '@/components/BackendModeBadge';
import { DesktopLicenseBanner } from '@/components/DesktopLicenseBanner';
import { DesktopUpdateBanner } from '@/components/DesktopUpdateBanner';
import { OnboardingGate } from '@/features/onboarding/OnboardingGate';
import { TenantWarningBanners } from '@/features/notifications/components/TenantWarningBanners';
import { AppCommandPalette } from './AppCommandPalette';
import { useSidebarData, type SidebarDeviceLite, type SidebarEventLite } from './useSidebarData';

interface AppShellProps {
  variant?: 'tenant' | 'admin';
}

export function AppShell({ variant = 'tenant' }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner variant={variant} />
      <Toaster position="top-right" />
    </SidebarProvider>
  );
}

function AppShellInner({ variant }: { variant: 'tenant' | 'admin' }) {
  const { t } = useTranslation();
  const isAdminVariant = variant === 'admin';
  useAutoCloseMobileSidebar();
  return (
    <>
      <Sidebar variant={isAdminVariant ? 'admin' : 'default'}>
        <ShellSidebarContent variant={variant} />
      </Sidebar>
      <SidebarInset>
        <ShellTopBar variant={variant} />
        {!isAdminVariant ? <DesktopUpdateBanner /> : null}
        {!isAdminVariant ? <DesktopLicenseBanner /> : null}
        {!isAdminVariant ? <TenantWarningBanners /> : null}
        <div className="flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
                {t('auth.loadingSession')}
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </SidebarInset>
      {!isAdminVariant ? <OnboardingGate /> : null}
    </>
  );
}

/**
 * Sprint U-1: chiude automaticamente il drawer mobile della Sidebar quando
 * la rotta cambia (perche' il `<Sheet>` shadcn non si chiude da solo dopo
 * un `<Link>` interno). Lasciato fuori dal SidebarProvider stesso per
 * non accoppiare il package `@slidecenter/ui` a `react-router`.
 */
function useAutoCloseMobileSidebar() {
  const location = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}

function ShellTopBar({ variant }: { variant: 'tenant' | 'admin' }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-6">
      <SidebarTrigger />
      <div className="flex flex-1 items-center gap-2">
        <CommandPaletteHint
          label={
            variant === 'admin' ? t('appShell.searchHintAdmin') : t('appShell.searchHint')
          }
        />
      </div>
      <div className="hidden items-center gap-2 lg:flex">
        <Badge variant={variant === 'admin' ? 'accent' : 'secondary'} className="font-mono">
          {variant === 'admin' ? t('admin.badge') : 'V2'}
        </Badge>
      </div>
    </header>
  );
}

/**
 * Pulsante visivo nella topbar che ricorda all'utente la scorciatoia ⌘K /
 * Ctrl+K. Non apre il dialog direttamente: simula la pressione di K con
 * meta/ctrl per riusare l'unico keydown handler in `AppCommandPalette`.
 */
function CommandPaletteHint({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const event = new KeyboardEvent('keydown', {
          key: 'k',
          code: 'KeyK',
          metaKey: true,
          ctrlKey: navigator.userAgent.toLowerCase().includes('mac') ? false : true,
          bubbles: true,
        });
        document.dispatchEvent(event);
      }}
      className="group inline-flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-input/50 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 truncate text-left">{label}</span>
      <kbd className="hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );
}

function ShellSidebarContent({ variant }: { variant: 'tenant' | 'admin' }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const tenantId = getTenantIdFromSession(session);
  const { state } = useSidebarData(variant === 'tenant' ? tenantId : null);

  const events = state.status === 'ready' ? state.data.events : [];
  const devices = state.status === 'ready' ? state.data.devices : [];

  const role = session?.user?.app_metadata?.role;
  const isSuperAdmin = role === 'super_admin';
  const isTenantAdmin = role === 'admin';

  return (
    <>
      <SidebarHeader>
        <Link to={variant === 'admin' ? '/admin' : '/'} className="flex items-center gap-2.5 px-1">
          <AppBrandLogo size="sm" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
              {t('app.displayName')}
            </p>
            {variant === 'admin' ? (
              <p className="truncate text-[10px] font-bold uppercase tracking-widest text-sc-accent">
                {t('admin.badge')}
              </p>
            ) : (
              <p className="truncate text-[10px] uppercase tracking-widest text-sidebar-foreground/40">
                {t('appShell.brandSubtitle')}
              </p>
            )}
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {variant === 'tenant' ? (
          <TenantSidebarSections
            events={events}
            devices={devices}
            isTenantAdmin={isTenantAdmin}
            isSuperAdmin={isSuperAdmin}
          />
        ) : (
          <AdminSidebarSections />
        )}
      </SidebarContent>

      <SidebarFooter>
        <BackendModeBadge />
        <UserFooter variant={variant} />
      </SidebarFooter>

      {variant === 'tenant' ? (
        <AppCommandPalette
          events={events.map((ev: SidebarEventLite) => ({ id: ev.id, name: ev.name }))}
          isAdmin={isTenantAdmin}
          isSuperAdmin={isSuperAdmin}
        />
      ) : null}
    </>
  );
}

function TenantSidebarSections({
  events,
  devices,
  isTenantAdmin,
  isSuperAdmin,
}: {
  events: ReturnType<typeof useSidebarData>['state'] extends { status: 'ready'; data: { events: infer E } }
  ? E
  : Array<{ id: string; name: string; status: string }>;
  devices: SidebarDeviceLite[];
  isTenantAdmin: boolean;
  isSuperAdmin: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={isActive('/')} onClick={() => navigate('/')}>
              <LayoutDashboard />
              <span>{t('nav.dashboard')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>{t('appShell.sectionEvents')}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === '/events'}
                onClick={() => navigate('/events')}
              >
                <CalendarDays />
                <span>{t('nav.events')}</span>
                <SidebarMenuBadge>{events.length}</SidebarMenuBadge>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {events.length === 0 ? (
              <SidebarMenuItem>
                <p className="px-2 py-2 text-xs italic text-sidebar-foreground/40">
                  {t('appShell.noEvents')}
                </p>
              </SidebarMenuItem>
            ) : (
              events.slice(0, 8).map((ev) => (
                <EventSidebarItem
                  key={ev.id}
                  eventId={ev.id}
                  name={ev.name}
                  status={ev.status}
                  isOpenByDefault={location.pathname.startsWith(`/events/${ev.id}`)}
                  isOnAirActive={location.pathname === `/events/${ev.id}/live`}
                  isProductionActive={location.pathname === `/events/${ev.id}`}
                />
              ))
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>{t('appShell.sectionRoomPCs')}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {devices.length === 0 ? (
              <SidebarMenuItem>
                <p className="px-2 py-2 text-xs italic text-sidebar-foreground/40">
                  {t('appShell.noDevices')}
                </p>
              </SidebarMenuItem>
            ) : (
              devices.slice(0, 12).map((dev) => (
                <SidebarMenuItem key={dev.id}>
                  <SidebarMenuButton
                    onClick={() =>
                      dev.event_id ? navigate(`/events/${dev.event_id}/live`) : undefined
                    }
                    title={dev.device_name}
                  >
                    <Monitor />
                    <span className="truncate">{dev.device_name}</span>
                    <DeviceStatusDot status={dev.status} />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>{t('appShell.sectionTools')}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive('/settings')}
                onClick={() => navigate('/settings')}
              >
                <Settings />
                <span>{t('nav.settings')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {isTenantAdmin ? (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive('/team')}
                    onClick={() => navigate('/team')}
                  >
                    <Users />
                    <span>{t('nav.team')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive('/centri-slide')}
                    onClick={() => navigate('/centri-slide')}
                  >
                    <Server />
                    <span>{t('nav.desktopDevices')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive('/network-map')}
                    onClick={() => navigate('/network-map')}
                  >
                    <Network />
                    <span>{t('nav.networkMap')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive('/billing')}
                    onClick={() => navigate('/billing')}
                  >
                    <CreditCard />
                    <span>{t('nav.billing')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive('/audit')}
                    onClick={() => navigate('/audit')}
                  >
                    <ScrollText />
                    <span>{t('nav.activity')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive('/settings/privacy')}
                    onClick={() => navigate('/settings/privacy')}
                  >
                    <ShieldCheck />
                    <span>{t('appShell.privacy')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </>
            ) : null}
            {isSuperAdmin ? (
              <SidebarMenuItem>
                <SidebarMenuButton
                  variant="accent"
                  isActive={isActive('/admin')}
                  onClick={() => navigate('/admin')}
                >
                  <Sparkles />
                  <span>{t('admin.navOverview')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function AdminSidebarSections() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/admin/tenants') {
      return (
        location.pathname === '/admin/tenants' || location.pathname.startsWith('/admin/tenants/')
      );
    }
    return location.pathname === path;
  };

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>{t('appShell.sectionAdminMain')}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                variant="accent"
                isActive={isActive('/admin')}
                onClick={() => navigate('/admin')}
              >
                <LayoutDashboard />
                <span>{t('admin.navOverview')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                variant="accent"
                isActive={isActive('/admin/tenants')}
                onClick={() => navigate('/admin/tenants')}
              >
                <Users />
                <span>{t('admin.navTenants')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                variant="accent"
                isActive={isActive('/admin/audit')}
                onClick={() => navigate('/admin/audit')}
              >
                <ScrollText />
                <span>{t('admin.navAudit')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                variant="accent"
                isActive={isActive('/admin/health')}
                onClick={() => navigate('/admin/health')}
              >
                <Wrench />
                <span>{t('health.navLabel')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => navigate('/')}>
                <ArrowLeft />
                <span>{t('admin.backToTenant')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function EventSidebarItem({
  eventId,
  name,
  status,
  isOpenByDefault,
  isOnAirActive,
  isProductionActive,
}: {
  eventId: string;
  name: string;
  status: string;
  isOpenByDefault: boolean;
  isOnAirActive: boolean;
  isProductionActive: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(isOpenByDefault);
  const isLive = status === 'active';

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={isOpenByDefault}
            className="group/event-trigger justify-between"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <CalendarDays />
              <span className="truncate">{name}</span>
            </div>
            <span className="flex items-center gap-1.5">
              {isLive ? (
                <span
                  aria-label="live"
                  className="inline-block size-1.5 animate-pulse rounded-full bg-sc-success"
                />
              ) : null}
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 shrink-0 transition-transform',
                  open && 'rotate-90',
                )}
              />
            </span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={isProductionActive}>
                <Link to={`/events/${eventId}`}>
                  <Wrench />
                  <span>{t('appShell.production')}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={isOnAirActive}>
                <Link to={`/events/${eventId}/live`}>
                  <Tv />
                  <span>{t('appShell.onAir')}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function DeviceStatusDot({ status }: { status: SidebarDeviceLite['status'] }) {
  const cls =
    status === 'online'
      ? 'bg-sc-success'
      : status === 'degraded'
        ? 'bg-sc-warning'
        : 'bg-sidebar-foreground/30';
  return (
    <span
      className={cn('ml-auto inline-block size-1.5 shrink-0 rounded-full', cls)}
      aria-hidden="true"
    />
  );
}

function UserFooter({ variant }: { variant: 'tenant' | 'admin' }): ReactNode {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const isDesktop = getBackendMode() === 'desktop';
  const userEmail = session?.user?.email ?? null;

  async function handleLogout() {
    await getSupabaseBrowserClient().auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex flex-col gap-2">
      {userEmail ? (
        <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-2 py-1.5 text-xs">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold uppercase text-primary">
            {userEmail.slice(0, 1)}
          </div>
          <span className="min-w-0 flex-1 truncate text-sidebar-foreground/80">{userEmail}</span>
        </div>
      ) : null}
      {variant === 'admin' ? null : !isDesktop && userEmail ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleLogout()}
          className="justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut />
          {t('auth.logout')}
        </Button>
      ) : null}
    </div>
  );
}
