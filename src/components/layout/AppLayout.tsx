'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { type IconType } from 'react-icons';
import { GiBaseballBat, GiBaseballGlove, GiThrowingBall } from 'react-icons/gi';
import { FiHome, FiUsers, FiSettings, FiList, FiChevronLeft, FiChevronRight, FiUser, FiLogOut } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
  icon: IconType;
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: FiHome },
  { name: 'Matchup', href: '/matchup', icon: GiBaseballBat },
  { name: 'Lineup', href: '/lineup', icon: FiList },
  { name: 'Pitching', href: '/pitching', icon: GiThrowingBall },
  { name: 'Roster', href: '/roster', icon: FiUsers },
  { name: 'League', href: '/league', icon: GiBaseballGlove },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    // Initialize from localStorage if available, default to true if not
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebarOpen');
      return saved ? JSON.parse(saved) : true;
    }
    return true;
  });
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Update localStorage when sidebar state changes
  useEffect(() => {
    localStorage.setItem('sidebarOpen', JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  // Close account drawer when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isAccountOpen && !(event.target as Element).closest('.account-drawer')) {
        setIsAccountOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAccountOpen]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        window.location.href = '/';
      } else {
        throw new Error('Logout failed');
      }
    } catch (error) {
      console.error('Logout error:', error);
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'w-48' : 'w-16'} bg-surface shadow-lg transition-all duration-300 relative`}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className={`flex items-center justify-center border-b border-border transition-all duration-300 ${isSidebarOpen ? 'h-32 px-4' : 'h-16 px-2'}`}>
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

          {/* Navigation */}
          <nav aria-label="Primary" className="flex-1 px-2 py-4 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  role="menuitem"
                  title={item.name}
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
                    <span className="font-body text-sm font-semibold truncate">
                      {item.name}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Account Section */}
          <div className="border-t border-border px-2 py-4">
            <button
              onClick={() => setIsAccountOpen(!isAccountOpen)}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors w-full',
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
                <span className="font-body text-sm font-semibold truncate">
                  Account
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Floating Collapse Button */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute top-6 -right-3 w-6 h-6 bg-surface border border-border rounded-full shadow-md hover:shadow-lg transition-shadow flex items-center justify-center"
          aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Icon
            icon={isSidebarOpen ? FiChevronLeft : FiChevronRight}
            size={12}
            className="text-muted-foreground"
          />
        </button>
      </div>

      {/* Account Drawer */}
      <div 
        className={cn(
          'account-drawer fixed w-48 bg-surface shadow-xl border border-border rounded-lg transition-all duration-300 z-50',
          isAccountOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        )}
        style={{ 
          left: isSidebarOpen ? '12.5rem' : '4.5rem',
          bottom: '1rem',
          transformOrigin: 'bottom left'
        }}
      >
        <div className="flex flex-col">
          {/* Drawer Header */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <Icon icon={FiUser} size={16} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Yahoo User</p>
                <p className="text-xs text-muted-foreground">Account</p>
              </div>
            </div>
          </div>

          {/* Drawer Content */}
          <div className="px-2 py-3 space-y-1">
            {/* User Actions */}
            <div className="mb-3">
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                User
              </p>
              <Link
                href="/settings"
                className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setIsAccountOpen(false)}
              >
                <Icon icon={FiSettings} size={16} className="flex-shrink-0 group-hover:text-foreground" />
                <span>Settings</span>
              </Link>
            </div>

            {/* Admin Actions */}
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
                onClick={() => setIsAccountOpen(false)}
              >
                <Icon 
                  icon={FiSettings} 
                  size={16} 
                  className={cn(
                    'flex-shrink-0',
                    pathname.startsWith('/admin') ? 'text-secondary-foreground' : 'group-hover:text-foreground'
                  )} 
                />
                <span>Admin Panel</span>
              </Link>
            </div>

            {/* Sign Out */}
            <div className="pt-2 border-t border-border">
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon icon={FiLogOut} size={16} className="flex-shrink-0 group-hover:text-foreground" />
                <span>{isLoggingOut ? 'Signing out...' : 'Sign out'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay */}
      {isAccountOpen && (
        <div 
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setIsAccountOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
} 