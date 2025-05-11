import React, { ReactNode } from 'react';
import { Sidebar } from './';
import { Header } from './';
import { HeaderProps } from '@/app/types/ui';

interface LayoutProps {
  children: ReactNode;
  teamData?: {
    team?: {
      name?: string;
      team_logo?: string;
      url?: string;
      league_name?: string;
      record?: string;
      rank?: number;
    };
  };
  loading?: boolean;
}

export default function Layout({ children, teamData, loading = false }: LayoutProps) {
  const headerTeam = teamData?.team ? {
    name: teamData.team.name || 'Team Name',
    logo: teamData.team.team_logo,
    url: teamData.team.url,
    league: teamData.team.league_name || 'Unknown League',
    record: teamData.team.record || '0-0',
    rank: teamData.team.rank
  } : undefined;

  return (
    <div className="flex min-h-screen bg-[#f2f2f6]">
      <Sidebar />
      <div className="flex-1 min-w-0 md:ml-[220px] flex flex-col">
        <Header team={headerTeam} loading={loading} />
        <div className="max-w-[1280px] mx-auto w-full px-3 md:px-6 py-6">
          {children}
        </div>
      </div>
    </div>
  );
} 