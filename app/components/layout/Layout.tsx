import React, { ReactNode } from 'react';
import { Sidebar } from './';
import { Header } from './';
import { HeaderProps } from '@/app/types/ui';

// Centralized styles
const styles = {
  layout: 'flex min-h-screen bg-[#f2f2f6]',
  mainContent: 'flex-1 min-w-0 ml-[220px] flex flex-col',
  contentContainer: 'max-w-[1280px] mx-auto w-full px-3 md:px-6 py-6',
};

interface LayoutProps {
  children: ReactNode;
  teamData?: {
    team?: HeaderProps['team'];
  };
  loading?: boolean;
}

export default function Layout({ children, teamData, loading = false }: LayoutProps) {
  // Ensure consistent data structure between server and client
  const headerTeam = teamData?.team ? {
    name: teamData.team.name || 'Team Name',
    team_logo: teamData.team.team_logo,
    url: teamData.team.url,
    league_name: teamData.team.league_name || 'Unknown League',
    record: teamData.team.record || '0-0',
    rank: teamData.team.rank
  } : undefined;

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <Sidebar />
      
      {/* Main content area */}
      <div className={styles.mainContent}>
        {/* Header */}
        <Header team={headerTeam} loading={loading} />
        
        {/* Content */}
        <div className={styles.contentContainer}>
          {children}
        </div>
      </div>
    </div>
  );
} 