import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeft } from 'lucide-react';

import { cn } from '../../lib/utils';
import { useIsMobile } from '../../hooks/use-mobile';
import { Button } from './button';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from './sheet';
import { TooltipProvider } from './tooltip';

/**
 * Sidebar shadcn-style adapter (Sprint U-1).
 *
 * Versione "lite" del componente Sidebar shadcn ufficiale: NON include
 * la modalita' "icon-only collapsed" (non utile per la nostra IA a 2
 * livelli con sezioni nominate). Include:
 *  - SidebarProvider con context per mobile drawer + persistenza cookie
 *  - Sidebar (aside fisso desktop, Sheet drawer su mobile)
 *  - SidebarTrigger (mobile)
 *  - SidebarInset (main area)
 *  - SidebarHeader / SidebarContent / SidebarFooter
 *  - SidebarGroup / SidebarGroupLabel / SidebarGroupContent
 *  - SidebarMenu / SidebarMenuItem / SidebarMenuButton (con isActive)
 *  - SidebarMenuSub / SidebarMenuSubItem / SidebarMenuSubButton (per livello 2)
 *  - SidebarSeparator
 */

const SIDEBAR_WIDTH = '17rem';
const SIDEBAR_WIDTH_MOBILE = '18rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

interface SidebarContextValue {
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleMobile: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within <SidebarProvider>');
  }
  return ctx;
}

interface SidebarProviderProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultOpenMobile?: boolean;
}

const SidebarProvider = React.forwardRef<HTMLDivElement, SidebarProviderProps>(
  ({ defaultOpenMobile = false, className, style, children, ...props }, ref) => {
    const isMobile = useIsMobile();
    const [openMobile, setOpenMobile] = React.useState(defaultOpenMobile);

    const toggleMobile = React.useCallback(() => {
      setOpenMobile((s) => !s);
    }, []);

    React.useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
          (event.metaKey || event.ctrlKey) &&
          isMobile
        ) {
          event.preventDefault();
          toggleMobile();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMobile, toggleMobile]);

    const ctx = React.useMemo<SidebarContextValue>(
      () => ({ isMobile, openMobile, setOpenMobile, toggleMobile }),
      [isMobile, openMobile, toggleMobile],
    );

    return (
      <SidebarContext.Provider value={ctx}>
        <TooltipProvider delayDuration={120}>
          <div
            ref={ref}
            data-slot="sidebar-wrapper"
            className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
            style={
              {
                '--sidebar-width': SIDEBAR_WIDTH,
                '--sidebar-width-mobile': SIDEBAR_WIDTH_MOBILE,
                ...style,
              } as React.CSSProperties
            }
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = 'SidebarProvider';

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'admin';
}

const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ variant = 'default', className, children, ...props }, ref) => {
    const { isMobile, openMobile, setOpenMobile } = useSidebar();

    if (isMobile) {
      return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent
            side="left"
            className="w-[var(--sidebar-width-mobile)] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
            style={{ '--sidebar-width-mobile': SIDEBAR_WIDTH_MOBILE } as React.CSSProperties}
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Sidebar nav</SheetDescription>
            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <aside
        ref={ref}
        data-slot="sidebar"
        data-variant={variant}
        className={cn(
          'sticky top-0 hidden h-svh w-[var(--sidebar-width)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex',
          variant === 'admin' && 'border-sc-accent/25',
          className,
        )}
        {...props}
      >
        {children}
      </aside>
    );
  },
);
Sidebar.displayName = 'Sidebar';

const SidebarTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, onClick, ...props }, ref) => {
    const { toggleMobile } = useSidebar();
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        className={cn('size-8 lg:hidden', className)}
        onClick={(event) => {
          onClick?.(event);
          toggleMobile();
        }}
        {...props}
      >
        <PanelLeft />
        <span className="sr-only">Toggle sidebar</span>
      </Button>
    );
  },
);
SidebarTrigger.displayName = 'SidebarTrigger';

const SidebarInset = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <main
      ref={ref}
      data-slot="sidebar-inset"
      className={cn('relative flex min-h-svh flex-1 flex-col bg-background', className)}
      {...props}
    />
  ),
);
SidebarInset.displayName = 'SidebarInset';

const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-header"
      className={cn('flex flex-col gap-2 p-3', className)}
      {...props}
    />
  ),
);
SidebarHeader.displayName = 'SidebarHeader';

const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-footer"
      className={cn('flex flex-col gap-2 border-t border-sidebar-border p-3', className)}
      {...props}
    />
  ),
);
SidebarFooter.displayName = 'SidebarFooter';

const SidebarSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <Separator
      ref={ref}
      data-slot="sidebar-separator"
      className={cn('mx-2 w-auto bg-sidebar-border', className)}
      {...props}
    />
  ),
);
SidebarSeparator.displayName = 'SidebarSeparator';

const SidebarContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto py-2', className)}
      {...props}
    />
  ),
);
SidebarContent.displayName = 'SidebarContent';

const SidebarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-group"
      className={cn('flex flex-col gap-1 px-2 py-1.5', className)}
      {...props}
    />
  ),
);
SidebarGroup.displayName = 'SidebarGroup';

const SidebarGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      ref={ref as React.Ref<HTMLDivElement>}
      data-slot="sidebar-group-label"
      className={cn(
        'flex h-7 shrink-0 items-center justify-between rounded-md px-2 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/60',
        className,
      )}
      {...props}
    />
  );
});
SidebarGroupLabel.displayName = 'SidebarGroupLabel';

const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-group-content"
      className={cn('w-full text-sm', className)}
      {...props}
    />
  ),
);
SidebarGroupContent.displayName = 'SidebarGroupContent';

const SidebarMenu = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul
      ref={ref}
      data-slot="sidebar-menu"
      className={cn('flex w-full min-w-0 flex-col gap-0.5', className)}
      {...props}
    />
  ),
);
SidebarMenu.displayName = 'SidebarMenu';

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      data-slot="sidebar-menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  ),
);
SidebarMenuItem.displayName = 'SidebarMenuItem';

const sidebarMenuButtonVariants = cva(
  'flex w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: '',
        accent:
          'data-[active=true]:bg-sc-accent/15 data-[active=true]:text-sc-accent hover:bg-sc-accent/10 hover:text-sc-accent',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

interface SidebarMenuButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  asChild?: boolean;
  isActive?: boolean;
}

const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ asChild = false, isActive = false, variant, className, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        data-slot="sidebar-menu-button"
        data-active={isActive}
        className={cn(
          sidebarMenuButtonVariants({ variant }),
          isActive && variant !== 'accent' && 'bg-sidebar-accent text-sidebar-accent-foreground',
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

const SidebarMenuSub = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul
      ref={ref}
      data-slot="sidebar-menu-sub"
      className={cn(
        'mx-3.5 flex min-w-0 translate-x-px flex-col gap-0.5 border-l border-sidebar-border px-2 py-0.5',
        className,
      )}
      {...props}
    />
  ),
);
SidebarMenuSub.displayName = 'SidebarMenuSub';

const SidebarMenuSubItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      data-slot="sidebar-menu-sub-item"
      className={cn('relative', className)}
      {...props}
    />
  ),
);
SidebarMenuSubItem.displayName = 'SidebarMenuSubItem';

interface SidebarMenuSubButtonProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  asChild?: boolean;
  isActive?: boolean;
}

const SidebarMenuSubButton = React.forwardRef<HTMLAnchorElement, SidebarMenuSubButtonProps>(
  ({ asChild = false, isActive = false, className, ...props }, ref) => {
    const Comp = asChild ? Slot : 'a';
    return (
      <Comp
        ref={ref as React.Ref<HTMLAnchorElement>}
        data-slot="sidebar-menu-sub-button"
        data-active={isActive}
        className={cn(
          'flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-xs text-sidebar-foreground/80 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-3.5 [&>svg]:shrink-0',
          isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarMenuSubButton.displayName = 'SidebarMenuSubButton';

const SidebarMenuAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    data-slot="sidebar-menu-action"
    className={cn(
      'absolute right-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground/60 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-3.5',
      className,
    )}
    {...props}
  />
));
SidebarMenuAction.displayName = 'SidebarMenuAction';

const SidebarMenuBadge = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-menu-badge"
      className={cn(
        'pointer-events-none absolute right-2 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-md bg-sidebar-accent px-1 text-[10px] font-semibold tabular-nums text-sidebar-accent-foreground',
        className,
      )}
      {...props}
    />
  ),
);
SidebarMenuBadge.displayName = 'SidebarMenuBadge';

export {
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarInset,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarMenuAction,
  SidebarMenuBadge,
};
