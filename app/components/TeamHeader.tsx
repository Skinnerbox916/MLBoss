import React from 'react';
import Link from 'next/link';
import { TeamHeaderProps } from '@/app/types/ui';

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

export default function TeamHeader({ team, loading = false, className = '' }: TeamHeaderProps) {
  if (loading) {
    return (
      <div className={`w-full bg-white border-b border-gray-200 animate-pulse p-2 ${className}`}>
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
    <div className={`w-full bg-white border-b border-gray-200 ${className}`}>
      <div className="max-w-screen-xl mx-auto px-4 py-3">
        <div className="flex items-center">
          {team.logo_url && (
            <img 
              src={team.logo_url} 
              alt="Team Logo" 
              className="w-12 h-12 rounded-full mr-3 border"
            />
          )}
          <div>
            <span className="text-lg font-bold text-[#3C1791] hover:text-[#2A1066] transition-colors inline-flex items-center gap-1">
              {team.name || 'Team Name'}
            </span>
            <div className="text-gray-600 text-sm">
              {team.record && `${team.record}`}
              {team.manager && (team.record ? ` | Manager: ${team.manager}` : `Manager: ${team.manager}`)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 