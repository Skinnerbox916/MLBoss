'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FiSettings, FiUser, FiLogOut } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { Text } from '@/components/typography';
import { cn } from '@/lib/utils';
import LeagueSwitcher from './LeagueSwitcher';

interface AccountMenuContentProps {
  onNavigate: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}

// Inner content of the Account drawer. Rendered inside positioning wrappers
// owned by DesktopSidebar (anchored to sidebar bottom) and MobileChrome
// (anchored under the mobile top bar) — keep this purely about the menu
// items so both presentations stay in sync.
export default function AccountMenuContent({
  onNavigate,
  onLogout,
  isLoggingOut,
}: AccountMenuContentProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
            <Icon icon={FiUser} size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Yahoo User</p>
            <Text variant="caption">Account</Text>
          </div>
        </div>
      </div>

      <div className="px-2 py-3 space-y-1">
        <LeagueSwitcher onNavigate={onNavigate} />

        <div className="mb-3">
          <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            User
          </p>
          <Link
            href="/settings"
            className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onNavigate}
          >
            <Icon icon={FiSettings} size={16} className="flex-shrink-0 group-hover:text-foreground" />
            <span>Settings</span>
          </Link>
        </div>

        <div className="mb-3">
          <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Admin
          </p>
          <Link
            href="/admin"
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              pathname.startsWith('/admin')
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={onNavigate}
          >
            <Icon
              icon={FiSettings}
              size={16}
              className={cn(
                'flex-shrink-0',
                pathname.startsWith('/admin')
                  ? 'text-secondary-foreground'
                  : 'group-hover:text-foreground'
              )}
            />
            <span>Admin Panel</span>
          </Link>
        </div>

        <div className="pt-2 border-t border-border">
          <button
            onClick={onLogout}
            disabled={isLoggingOut}
            className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon icon={FiLogOut} size={16} className="flex-shrink-0 group-hover:text-foreground" />
            <span>{isLoggingOut ? 'Signing out...' : 'Sign out'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
