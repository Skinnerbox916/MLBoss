import React from 'react';
import { getOrdinalSuffix } from '@/app/utils/formatters';
import { HeaderProps } from '@/app/types/ui';

/**
 * @deprecated Use the new `team` prop instead of `teamData`. This interface will be removed in a future version.
 */
interface LegacyHeaderProps {
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

// Support both new and legacy prop structures
type Props = HeaderProps | LegacyHeaderProps;

export default function Header(props: Props) {
  const { loading = false } = props;
  
  // Handle both new and legacy prop structures
  const team = 'team' in props 
    ? props.team 
    : (props as LegacyHeaderProps).teamData?.team;

  if (loading) {
    return (
      <div className="w-full border-b border-gray-200 animate-pulse mb-4">
        <div className="h-[80px] flex items-center">
          <div className="max-w-screen-xl w-full mx-auto px-6">
            <div className="flex items-center justify-center">
              <div className="w-12 h-12 bg-gray-200 rounded-full mr-3"></div>
              <div>
                <div className="h-5 bg-gray-200 rounded w-40 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-60"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Early return with consistent structure
  if (!team) {
    return (
      <div className="w-full border-b border-gray-200 mb-4 bg-white shadow">
        <div className="h-[80px] flex items-center">
          <div className="max-w-screen-xl w-full mx-auto px-6">
            <div className="flex items-center justify-center">
              <div className="text-gray-400">No team data available</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Ensure all values have defaults to prevent hydration mismatches
  const teamName = team.name || 'Team Name';
  const teamLogo = team.team_logo || '';
  const teamUrl = team.url || '#';
  const leagueName = team.league_name || 'Unknown League';
  const record = team.record || '0-0';
  const rank = team.rank ? getOrdinalSuffix(team.rank) : '-';

  return (
    <div className="w-full border-b border-gray-200 mb-4 bg-white shadow">
      <div className="h-[80px] flex items-center">
        <div className="max-w-screen-xl w-full mx-auto px-6">
          <div className="flex items-center justify-center">
            {teamLogo && (
              <img 
                src={teamLogo} 
                alt={`${teamName} Logo`} 
                className="w-14 h-14 rounded-full mr-4 border"
              />
            )}
            <div>
              <a 
                href={teamUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xl font-bold text-[#3C1791] hover:text-[#2A1066] transition-colors inline-flex items-center gap-1"
              >
                {teamName}
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className="h-4 w-4 text-gray-400" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" 
                  />
                </svg>
              </a>
              <div className="text-gray-600 text-sm mt-1">
                {leagueName}
                {" | "}
                {record}
                {" | "}
                {rank}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 