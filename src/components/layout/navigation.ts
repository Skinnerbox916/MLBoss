import { type IconType } from 'react-icons';
import { GiBaseballGlove, GiThrowingBall } from 'react-icons/gi';
import { FiHome, FiUsers, FiList } from 'react-icons/fi';

export interface NavItem {
  name: string;
  href: string;
  icon: IconType;
}

// Single source of truth for primary navigation. Both DesktopSidebar and
// MobileChrome consume this so the two presentations cannot drift.
export const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: FiHome },
  { name: 'Lineup', href: '/lineup', icon: FiList },
  { name: 'Streaming', href: '/streaming', icon: GiThrowingBall },
  { name: 'Roster', href: '/roster', icon: FiUsers },
  { name: 'League', href: '/league', icon: GiBaseballGlove },
];
