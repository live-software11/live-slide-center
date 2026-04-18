import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  Monitor,
  ScrollText,
  Settings,
  ShieldCheck,
  Tv,
  Users,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@slidecenter/ui';

interface AppCommandPaletteProps {
  events: Array<{ id: string; name: string }>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/**
 * Sprint U-1 — Command palette globale (CTRL/CMD + K). Mostra:
 *  - Azioni rapide (Dashboard, Eventi, Settings, ...)
 *  - Lista eventi (top 20 recenti) → naviga a `/events/:id`
 *
 * Aperta da CTRL/CMD+K oppure da qualsiasi `<kbd>` con `data-cmdk-trigger`.
 * Chiusa su ESC, click esterno, o navigazione (ogni `runCommand` chiama
 * setOpen(false)).
 */
export function AppCommandPalette({ events, isAdmin, isSuperAdmin }: AppCommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((s) => !s);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const runCommand = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const recentEvents = useMemo(() => events.slice(0, 12), [events]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t('appShell.commandPlaceholder')} />
      <CommandList>
        <CommandEmpty>{t('appShell.commandEmpty')}</CommandEmpty>

        <CommandGroup heading={t('appShell.cmdJumpTo')}>
          <CommandItem onSelect={() => runCommand(() => navigate('/'))}>
            <LayoutDashboard />
            <span>{t('nav.dashboard')}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/events'))}>
            <CalendarDays />
            <span>{t('nav.events')}</span>
            <CommandShortcut>E</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/settings'))}>
            <Settings />
            <span>{t('nav.settings')}</span>
            <CommandShortcut>S</CommandShortcut>
          </CommandItem>
          {isAdmin ? (
            <>
              <CommandItem onSelect={() => runCommand(() => navigate('/team'))}>
                <Users />
                <span>{t('nav.team')}</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/billing'))}>
                <CreditCard />
                <span>{t('nav.billing')}</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/audit'))}>
                <ScrollText />
                <span>{t('nav.activity')}</span>
              </CommandItem>
            </>
          ) : null}
          {isSuperAdmin ? (
            <CommandItem onSelect={() => runCommand(() => navigate('/admin'))}>
              <ShieldCheck />
              <span>{t('admin.navOverview')}</span>
            </CommandItem>
          ) : null}
        </CommandGroup>

        {recentEvents.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('appShell.cmdEvents')}>
              {recentEvents.map((ev) => (
                <CommandItem
                  key={ev.id}
                  value={`event-${ev.id}-${ev.name}`}
                  onSelect={() => runCommand(() => navigate(`/events/${ev.id}`))}
                >
                  <CalendarDays />
                  <span className="truncate">{ev.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t('appShell.cmdOnAir')}>
              {recentEvents.map((ev) => (
                <CommandItem
                  key={`live-${ev.id}`}
                  value={`live-${ev.id}-${ev.name}`}
                  onSelect={() => runCommand(() => navigate(`/events/${ev.id}/live`))}
                >
                  <Tv />
                  <span className="truncate">{ev.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading={t('appShell.cmdHelp')}>
          <CommandItem onSelect={() => runCommand(() => navigate('/status'))}>
            <Monitor />
            <span>{t('auth.statusPageLink')}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
