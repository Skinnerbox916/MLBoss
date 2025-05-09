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
      <div className="w-full bg-white border-b border-gray-200 animate-pulse p-2">
        <div className="flex items-center">
          <div className="w-12 h-12 bg-gray-200 rounded-full mr-4"></div>
          <div className="flex-1">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-white border-b border-gray-200">
      <div className="max-w-screen-xl mx-auto px-4 py-3">
        <div className="flex items-center">
          {getTeamProperty('team_logo') && (
            <img 
              src={getTeamProperty('team_logo')} 
              alt="Team Logo" 
              className="w-12 h-12 rounded-full mr-3 border"
            />
          )}
          <div>
            <a 
              href={getTeamProperty('url', '#')} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-lg font-bold text-[#3C1791] hover:text-[#2A1066] transition-colors inline-flex items-center gap-1"
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
            <div className="text-gray-600 text-sm">
              {getTeamProperty('league_name', 'Unknown League')}
              {" | "}
              {getTeamProperty('record', '0-0')}
              {" | "}
              {getTeamProperty('rank') ? `${getOrdinalSuffix(getTeamProperty('rank'))}` : '-'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 