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
} from 'react-icons/hi';

// Centralized styles
const styles = {
  container: 'fixed top-0 left-0 w-[220px] h-screen z-20 bg-white border-r border-gray-200 flex flex-col',
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

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [adminOpen, setAdminOpen] = useState(false);
  
  const navigationItems = [
    {
      name: 'Dashboard',
      href: '/dashboard',
      icon: HiHome
    },
    {
      name: 'Lineup',
      href: '/lineup',
      icon: HiViewList
    },
    {
      name: 'Matchup',
      href: '/matchup',
      icon: HiUsers
    },
    {
      name: 'Roster',
      href: '/roster',
      icon: HiClipboardList
    },
    {
      name: 'League',
      href: '/league',
      icon: HiGlobe
    }
  ];

  const handleLogout = () => {
    fetch('/api/auth/logout')
      .then(() => {
        router.push('/');
      });
  };

  return (
    <div className={styles.container}>
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
              >
                <HiCog className={`${styles.navIcon} ${styles.iconInactive}`} />
                <span>Admin</span>
                <span className={styles.dropdown}>▼</span>
              </button>
              
              {adminOpen && (
                <div className={styles.dropdownMenu}>
                  <Link 
                    href="/admin"
                    className={styles.dropdownItem}
                  >
                    Admin Console
                  </Link>
                  <Link 
                    href="/admin/settings"
                    className={styles.dropdownItem}
                  >
                    Settings
                  </Link>
                </div>
              )}
            </div>
          </li>
        </ul>
      </div>
      
      <div className={styles.footer}>
        <button
          onClick={handleLogout}
          className={styles.logoutButton}
        >
          Logout
        </button>
      </div>
    </div>
  );
} 