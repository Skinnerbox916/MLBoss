'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FiUser, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { cn } from '@/lib/utils';
import { navigation } from './navigation';
import AccountMenuContent from './AccountMenuContent';
import { usePendingNav } from './usePendingNav';

interface DesktopSidebarProps {
  isSidebarOpen: boolean;
  // False until the first frame after mount completes. We use it to suppress
  // width transitions on the initial localStorage restore so users with a
  // collapsed sidebar don't see a 300ms expand→collapse on every page load.
  isHydrated: boolean;
  onToggle: () => void;
  isAccountOpen: boolean;
  onAccountToggle: () => void;
  onAccountClose: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}

export default function DesktopSidebar({
  isSidebarOpen,
  isHydrated,
  onToggle,
  isAccountOpen,
  onAccountToggle,
  onAccountClose,
  onLogout,
  isLoggingOut,
}: DesktopSidebarProps) {
  const { markPending, isActiveOrPending } = usePendingNav();
  const widthTransition = isHydrated ? 'transition-all duration-300' : '';

  return (
    <>
      <aside
        aria-label="Primary navigation"
        className={cn(
          'hidden md:flex relative bg-surface shadow-lg',
          widthTransition,
          isSidebarOpen ? 'w-48' : 'w-16'
        )}
      >
        <div className="flex flex-col h-full w-full">
          <div
            className={cn(
              'flex items-center justify-center border-b border-border',
              widthTransition,
              isSidebarOpen ? 'h-32 px-4' : 'h-16 px-2'
            )}
          >
            <Link href="/dashboard">
              {isSidebarOpen ? (
                <Image
                  src="/assets/mlboss-logo-light.svg"
                  alt="MLBoss Logo"
                  width={128}
                  height={128}
                  priority
                  className="h-24 w-auto transition-all duration-300 transform-gpu"
                  style={{ transformOrigin: 'center' }}
                />
              ) : (
                <Image
                  src="/assets/mlboss-icon-light.svg"
                  alt="MLBoss Icon"
                  width={32}
                  height={32}
                  priority
                  className="w-8 h-8 object-contain transition-all duration-300 transform-gpu"
                  style={{ transformOrigin: 'center' }}
                />
              )}
            </Link>
          </div>

          <nav aria-label="Primary" className="flex-1 px-2 py-4 space-y-1">
            {navigation.map((item) => {
              const isActive = isActiveOrPending(item.href);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  role="menuitem"
                  title={item.name}
                  onClick={() => markPending(item.href)}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-accent/10 text-accent-foreground dark:bg-accent/20 border-l-4 border-accent'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    !isSidebarOpen && 'justify-center'
                  )}
                >
                  <Icon
                    icon={item.icon}
                    size={18}
                    className={cn(
                      'flex-shrink-0',
                      isActive ? 'text-accent' : 'group-hover:text-foreground'
                    )}
                  />
                  {isSidebarOpen && (
                    <span className="font-body text-sm font-semibold truncate">{item.name}</span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border px-2 py-4">
            <button
              onClick={onAccountToggle}
              className={cn(
                'account-drawer group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors w-full',
                isAccountOpen
                  ? 'bg-accent/10 text-accent-foreground dark:bg-accent/20 border-l-4 border-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                !isSidebarOpen && 'justify-center'
              )}
              title="Account"
            >
              <Icon
                icon={FiUser}
                size={18}
                className={cn(
                  'flex-shrink-0',
                  isAccountOpen ? 'text-accent' : 'group-hover:text-foreground'
                )}
              />
              {isSidebarOpen && (
                <span className="font-body text-sm font-semibold truncate">Account</span>
              )}
            </button>
          </div>
        </div>

        <button
          onClick={onToggle}
          className="absolute top-6 -right-3 w-6 h-6 bg-surface border border-border rounded-full shadow-md hover:shadow-lg transition-shadow flex items-center justify-center"
          aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Icon
            icon={isSidebarOpen ? FiChevronLeft : FiChevronRight}
            size={12}
            className="text-muted-foreground"
          />
        </button>
      </aside>

      {/* Desktop-only: account drawer anchored next to sidebar bottom. */}
      <div
        className={cn(
          'account-drawer hidden md:block fixed w-48 bg-surface shadow-xl border border-border rounded-lg transition-all duration-300 z-50',
          isAccountOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        )}
        style={{
          left: isSidebarOpen ? '12.5rem' : '4.5rem',
          bottom: '1rem',
          transformOrigin: 'bottom left',
        }}
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
