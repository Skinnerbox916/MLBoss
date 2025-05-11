'use client';

import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import DashboardFrame from './DashboardFrame';

/**
 * Props for the ClientLayout component
 * @interface ClientLayoutProps
 * @property {ReactNode} children - The child components to be rendered
 */
type ClientLayoutProps = {
  children: ReactNode;
};

/**
 * Array of paths that should be wrapped in the DashboardFrame
 * Used to determine which pages should have the dashboard layout
 */
const DASHBOARD_PATHS = [
  '/dashboard',
  '/lineup',
  '/matchup',
  '/roster',
  '/league'
] as const;

/**
 * ClientLayout component that handles the layout structure of the application
 * Wraps dashboard pages in DashboardFrame and renders other pages directly
 * 
 * @param {ClientLayoutProps} props - The component props
 * @returns {JSX.Element} The rendered layout
 */
export default function ClientLayout({ children }: ClientLayoutProps) {
  const pathname = usePathname();

  // Determine if the current path should be wrapped in DashboardFrame
  const isDashboardPath = DASHBOARD_PATHS.some(path => pathname.startsWith(path));

  // Log the current path and whether it's a dashboard path for debugging
  console.debug(`[ClientLayout] Current path: ${pathname}, isDashboardPath: ${isDashboardPath}`);

  // Render either wrapped in DashboardFrame or directly based on the path
  return isDashboardPath ? (
    <DashboardFrame>{children}</DashboardFrame>
  ) : (
    children
  );
} 