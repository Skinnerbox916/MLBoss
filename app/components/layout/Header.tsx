import React from 'react';
import Link from 'next/link';

// Centralized styles
const styles = {
  header: 'w-full border-b border-gray-200 mb-4 bg-white shadow',
  container: 'h-[80px] flex items-center',
  content: 'max-w-screen-xl w-full mx-auto px-6',
  teamWrapper: 'flex items-center justify-center',
  teamLogo: 'w-14 h-14 rounded-full mr-4 border',
  teamName: 'text-xl font-bold text-[#3C1791] hover:text-[#2A1066] transition-colors inline-flex items-center gap-1',
  externalLinkIcon: 'h-4 w-4 text-gray-400',
  teamInfo: 'text-gray-600 text-sm mt-1',
  loadingContainer: 'w-full border-b border-gray-200 animate-pulse mb-4',
  loadingHeight: 'h-[80px] flex items-center',
  loadingContent: 'max-w-screen-xl w-full mx-auto px-6',
  loadingItemWrapper: 'flex items-center justify-center',
  loadingCircle: 'w-12 h-12 bg-gray-200 rounded-full mr-3',
  loadingLine1: 'h-5 bg-gray-200 rounded w-40 mb-2',
  loadingLine2: 'h-4 bg-gray-200 rounded w-60',
};

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

interface HeaderProps {
  teamData: any;
  loading: boolean;
}

export default function Header({ teamData, loading }: HeaderProps) {
  // Function to safely access team properties
  const getTeamProperty = (property: string, fallback: any = null) => {
    if (!teamData?.team) return fallback;
    return teamData.team[property] !== undefined ? teamData.team[property] : fallback;
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingHeight}>
          <div className={styles.loadingContent}>
            <div className={styles.loadingItemWrapper}>
              <div className={styles.loadingCircle}></div>
              <div>
                <div className={styles.loadingLine1}></div>
                <div className={styles.loadingLine2}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.header}>
      <div className={styles.container}>
        <div className={styles.content}>
          <div className={styles.teamWrapper}>
            {getTeamProperty('team_logo') && (
              <img 
                src={getTeamProperty('team_logo')} 
                alt="Team Logo" 
                className={styles.teamLogo}
              />
            )}
            <div>
              <a 
                href={getTeamProperty('url', '#')} 
                target="_blank" 
                rel="noopener noreferrer"
                className={styles.teamName}
              >
                {getTeamProperty('name', 'Team Name')}
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className={styles.externalLinkIcon}
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
              <div className={styles.teamInfo}>
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
    </div>
  );
} 