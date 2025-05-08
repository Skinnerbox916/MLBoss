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

// Custom styles - will be needed for the bullet points and other styling
const navStyles = `
  .bullet {
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: black;
    margin-right: 8px;
    vertical-align: middle;
  }
  
  .nav-link {
    display: flex;
    align-items: center;
    font-size: 15px;
    font-weight: 500;
  }
  
  .nav-icon {
    margin-right: 4px;
  }
  
  .nav-item {
    margin-bottom: 8px;
    display: flex;
    align-items: center;
  }
  
  .nav-container {
    width: 220px;
    background-color: white;
    border-right: 1px solid #e5e7eb;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  
  .admin-dropdown {
    font-size: 10px;
    margin-left: 4px;
  }
`;

interface NavigationProps {
  onLogout: () => void;
}

export default function Navigation({ onLogout }: NavigationProps) {
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
      href: '/dashboard/lineup',
      icon: HiViewList
    },
    {
      name: 'Matchup',
      href: '/dashboard/matchup',
      icon: HiUsers
    },
    {
      name: 'Roster',
      href: '/dashboard/roster',
      icon: HiClipboardList
    },
    {
      name: 'League',
      href: '/dashboard/league',
      icon: HiGlobe
    }
  ];

  return (
    <>
      <style jsx global>{navStyles}</style>
      <div className="nav-container">
        <div className="p-4 border-b border-gray-200 flex justify-center">
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
        
        <div className="flex-1 px-6 py-4">
          <ul className="list-none space-y-2">
            {navigationItems.map((item) => {
              const isActive = pathname === item.href || 
                              (item.href !== '/dashboard' && pathname?.startsWith(item.href));
              
              return (
                <li key={item.name} className="nav-item">
                  <div className="bullet"></div>
                  <Link href={item.href} 
                    className={`nav-link ${
                      isActive 
                        ? 'text-purple-700' 
                        : 'text-gray-700 hover:text-purple-600'
                    }`}
                  >
                    <item.icon className={`nav-icon h-5 w-5 ${
                      isActive ? 'text-purple-700' : ''
                    }`} />
                    <span>{item.name}</span>
                  </Link>
                </li>
              );
            })}
            
            {/* Admin dropdown */}
            <li className="nav-item">
              <div className="bullet"></div>
              <div className="relative inline-block w-full">
                <button
                  onClick={() => setAdminOpen(!adminOpen)}
                  className="nav-link flex items-center py-1 text-gray-700 hover:text-purple-600"
                >
                  <HiCog className="nav-icon h-5 w-5" />
                  <span>Admin</span>
                  <span className="admin-dropdown">▼</span>
                </button>
                
                {adminOpen && (
                  <div className="ml-9 mt-1">
                    <Link 
                      href="/admin"
                      className="block py-1 text-sm text-gray-700 hover:text-purple-600"
                    >
                      Admin Console
                    </Link>
                    <Link 
                      href="/admin/settings"
                      className="block py-1 text-sm text-gray-700 hover:text-purple-600"
                    >
                      Settings
                    </Link>
                  </div>
                )}
              </div>
            </li>
          </ul>
        </div>
        
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={onLogout}
            className="w-full py-1 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
} 