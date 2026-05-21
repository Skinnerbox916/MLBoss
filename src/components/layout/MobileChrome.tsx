'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FiUser } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { cn } from '@/lib/utils';
import { navigation } from './navigation';
import AccountMenuContent from './AccountMenuContent';
import { usePendingNav } from './usePendingNav';

// Mobile shell: top bar (logo + account trigger) and bottom tab bar.
// Together these replace the desktop sidebar below the `md` breakpoint
// so the main content can claim the full viewport width.

interface MobileTopBarProps {
  isAccountOpen: boolean;
  onAccountToggle: () => void;
  onAccountClose: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}

export function MobileTopBar({
  isAccountOpen,
  onAccountToggle,
  onAccountClose,
  onLogout,
  isLoggingOut,
}: MobileTopBarProps) {
  return (
    <>
      <header className="md:hidden flex items-center justify-between h-14 px-4 bg-surface border-b border-border shadow-sm shrink-0">
        <Link href="/dashboard" className="flex items-center" aria-label="MLBoss dashboard">
          <Image
            src="/assets/mlboss-icon-light.svg"
            alt="MLBoss"
            width={32}
            height={32}
            priority
            className="w-8 h-8"
          />
        </Link>
        <button
          onClick={onAccountToggle}
          className={cn(
            'account-drawer flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
            isAccountOpen
              ? 'bg-accent/10 text-accent'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          aria-label="Account"
          aria-expanded={isAccountOpen}
        >
          <Icon icon={FiUser} size={20} />
        </button>
      </header>

      {/* Mobile-only: account drawer drops from below the top bar, anchored right. */}
      <div
        className={cn(
          'account-drawer md:hidden fixed top-16 right-4 w-64 max-w-[calc(100vw-2rem)] bg-surface shadow-xl border border-border rounded-lg z-50 transition-all duration-200',
          isAccountOpen
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-2 pointer-events-none'
        )}
      >
        <AccountMenuContent
          onNavigate={onAccountClose}
          onLogout={onLogout}
          isLoggingOut={isLoggingOut}
        />
      </div>
    </>
  );
}

export function MobileBottomNav() {
  const { pathname, markPending, isActiveOrPending } = usePendingNav();

  return (
    <nav
      aria-label="Primary navigation"
      className="md:hidden flex items-stretch bg-surface border-t border-border shadow-[0_-1px_3px_rgba(0,0,0,0.04)] pb-[env(safe-area-inset-bottom)] shrink-0"
    >
      {navigation.map((item) => {
        const isCurrent = pathname === item.href;
        const showActive = isActiveOrPending(item.href);
        return (
          <Link
            key={item.name}
            href={item.href}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => markPending(item.href)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 py-2 border-t-2 transition-colors',
              showActive
                ? 'text-accent border-accent'
                : 'text-muted-foreground border-transparent hover:text-foreground'
            )}
          >
            <Icon icon={item.icon} size={20} className="flex-shrink-0" />
            <span className="font-body text-[10px] font-semibold leading-none">{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
