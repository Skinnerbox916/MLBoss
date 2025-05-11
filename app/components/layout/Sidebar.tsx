'use client';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { 
  HiHome, 
  HiViewList, 
  HiUsers, 
  HiClipboardList,
  HiGlobe,
  HiCog,
  HiMenu,
} from 'react-icons/hi';

// Centralized styles
const styles = {
  container: 'md:fixed md:top-0 md:left-0 md:w-[220px] md:h-screen z-20 bg-white border-r border-gray-200 flex flex-col',
  logoContainer: 'p-4 border-b border-gray-200 flex justify-center',
  navContainer: 'flex-1 px-6 py-4',
  navList: 'list-none space-y-2',
  navItem: 'flex items-center mb-2',
  bullet: 'inline-block w-1 h-1 rounded-full bg-[#3c1791] mr-2',
  navLink: 'flex items-center text-[15px] font-medium',
  navLinkActive: 'text-purple-700 font-semibold',
  navLinkInactive: 'text-gray-700 hover:text-purple-700',
  navIcon: 'mr-1 h-5 w-5',
  iconActive: 'text-purple-700',
  iconInactive: 'text-gray-600',
  dropdown: 'text-[10px] ml-1',
  dropdownMenu: 'ml-9 mt-1',
  dropdownItem: 'block py-1 text-sm text-gray-700 hover:text-purple-700',
  footer: 'p-4 border-t border-gray-200',
  logoutButton: 'w-full py-1 px-4 border border-gray-300 text-sm font-medium rounded-md text-white bg-[#3c1791] hover:bg-[#2a1066] transition-colors',
};

/**
 * Sidebar navigation component (consolidated from Navigation)
 * @param onLogout Optional logout handler. If not provided, defaults to API logout and redirect.
 */
export default function Sidebar({ onLogout }: { onLogout?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [adminOpen, setAdminOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigationItems = [
    { name: 'Dashboard', href: '/dashboard', icon: HiHome },
    { name: 'Lineup', href: '/lineup', icon: HiViewList },
    { name: 'Matchup', href: '/matchup', icon: HiUsers },
    { name: 'Roster', href: '/roster', icon: HiClipboardList },
    { name: 'League', href: '/league', icon: HiGlobe },
  ];

  // Default logout if not provided
  const handleLogout = onLogout || (() => {
    fetch('/api/auth/logout').then(() => {
      router.push('/');
    });
  });

  return (
    <>
      {/* Mobile menu button */}
      <button
        className="md:hidden fixed top-4 left-4 z-30 bg-white p-2 rounded shadow border border-gray-200"
        onClick={() => setMobileOpen(true)}
        aria-label="Open sidebar menu"
      >
        <HiMenu className="h-6 w-6 text-[#3c1791]" />
      </button>
      {/* Sidebar overlay for mobile */}
      <div
        className={`fixed inset-0 bg-black bg-opacity-40 z-20 transition-opacity md:hidden ${mobileOpen ? 'block' : 'hidden'}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      {/* Sidebar itself */}
      <div
        className={`$${mobileOpen ? '' : 'hidden '}md:flex ${styles.container} transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:static md:inset-auto md:shadow-none`}
        style={{ zIndex: 30 }}
      >
        {/* Close button for mobile */}
        <div className="md:hidden flex justify-end p-2">
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar menu"
            className="text-gray-700 hover:text-purple-700"
          >
            ✕
          </button>
        </div>
        {/* Sidebar content */}
        <div className={styles.logoContainer}>
          <Link href="/dashboard">
            <div className="flex flex-col items-center">
              <Image
                src="/MLBoss Logo.png"
                alt="MLBoss Logo"
                width={80}
                height={0}
                style={{ height: 'auto' }}
                priority
              />
            </div>
          </Link>
        </div>
        <div className={styles.navContainer}>
          <ul className={styles.navList}>
            {navigationItems.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== '/dashboard' && pathname?.startsWith(item.href));
              return (
                <li key={item.name} className={styles.navItem}>
                  <span className={styles.bullet}></span>
                  <Link href={item.href} 
                    className={`${styles.navLink} ${
                      isActive 
                        ? styles.navLinkActive
                        : styles.navLinkInactive
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <item.icon className={`${styles.navIcon} ${
                      isActive ? styles.iconActive : styles.iconInactive
                    }`} />
                    <span>{item.name}</span>
                  </Link>
                </li>
              );
            })}
            {/* Admin dropdown */}
            <li className={styles.navItem}>
              <span className={styles.bullet}></span>
              <div className="relative inline-block w-full">
                <button
                  onClick={() => setAdminOpen(!adminOpen)}
                  className={`${styles.navLink} ${styles.navLinkInactive}`}
                  aria-expanded={adminOpen}
                  aria-controls="admin-dropdown-menu"
                >
                  <HiCog className={`${styles.navIcon} ${styles.iconInactive}`} />
                  <span>Admin</span>
                  <span className={styles.dropdown}>▼</span>
                </button>
                {adminOpen && (
                  <div id="admin-dropdown-menu" className={styles.dropdownMenu}>
                    <Link href="/admin" className={styles.dropdownItem}>
                      Admin Console
                    </Link>
                    <Link href="/admin/settings" className={styles.dropdownItem}>
                      Settings
                    </Link>
                  </div>
                )}
              </div>
            </li>
          </ul>
        </div>
        <button
          onClick={() => { setMobileOpen(false); handleLogout(); }}
          className={styles.logoutButton}
        >
          Logout
        </button>
      </div>
    </>
  );
} 