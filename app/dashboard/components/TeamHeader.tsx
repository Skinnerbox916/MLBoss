import React from 'react';
import Link from 'next/link';

// Helper to add ordinal suffix to rank
function getOrdinalSuffix(rank: string | number) {
  const n = typeof rank === 'string' ? parseInt(rank, 10) : rank;
  if (isNaN(n)) return rank;
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return n + 'st';
  if (j === 2 && k !== 12) return n + 'nd';
  if (j === 3 && k !== 13) return n + 'rd';
  return n + 'th';
}

interface TeamHeaderProps {
  teamData: any;
  loading: boolean;
}

export default function TeamHeader({ teamData, loading }: TeamHeaderProps) {
  // Function to safely access team properties
  const getTeamProperty = (property: string, fallback: any = null) => {
    if (!teamData?.team) return fallback;
    return teamData.team[property] !== undefined ? teamData.team[property] : fallback;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 animate-pulse">
        <div className="flex items-center">
          <div className="w-14 h-14 bg-gray-200 rounded-full mr-4"></div>
          <div className="flex-1">
            <div className="h-6 bg-gray-200 rounded w-1/3 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Team identity */}
        <div className="flex items-center">
          {getTeamProperty('team_logo') && (
            <img 
              src={getTeamProperty('team_logo')} 
              alt="Team Logo" 
              className="w-14 h-14 rounded-full mr-4 border"
            />
          )}
          <div>
            <a 
              href={getTeamProperty('url', '#')} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xl font-bold text-[#3C1791] hover:text-[#2A1066] transition-colors inline-flex items-center gap-1"
            >
              {getTeamProperty('name', 'Team Name')}
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
              {getTeamProperty('league_name', 'Unknown League')}
              {" | "}
              {getTeamProperty('record', '0-0')}
              {" | "}
              {getTeamProperty('rank') ? `${getOrdinalSuffix(getTeamProperty('rank'))}` : '-'}
            </div>
          </div>
        </div>

        {/* Right: Team Stats */}
        <div className="flex flex-wrap gap-4 md:gap-6">
          <div className="text-center">
            <span className="block text-gray-700 font-medium text-xs">Waiver Priority</span>
            <span className="block text-lg font-bold text-gray-900">{getTeamProperty('waiver_priority', '-')}</span>
          </div>
          <div className="text-center">
            <span className="block text-gray-700 font-medium text-xs">Weekly Adds</span>
            <span className="block text-lg font-bold text-gray-900">
              {getTeamProperty('moves_used', 0)} of {getTeamProperty('moves_limit', 0)}
            </span>
          </div>
          <div className="text-center">
            <span className="block text-gray-700 font-medium text-xs">Available Swaps</span>
            <span className="block text-lg font-bold text-gray-900">{getTeamProperty('available_swaps', 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
} 