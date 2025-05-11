import React from 'react';
import { HiStar } from 'react-icons/hi';

interface MatchupScoreCardProps {
  wins: number;
  losses: number;
  ties: number;
  myTeamLogo?: string;
  opponentLogo?: string;
  opponentName: string;
  onViewAllClick: () => void;
}

export default function MatchupScoreCard({
  wins,
  losses,
  ties,
  myTeamLogo,
  opponentLogo,
  opponentName,
  onViewAllClick
}: MatchupScoreCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <HiStar className="h-6 w-6 text-amber-500" />
        <h2 className="text-lg font-semibold text-gray-700">Matchup Score</h2>
      </div>
      
      {/* Team Avatars and VS - Reduced size to give more space to scores */}
      <div className="flex justify-center items-center mb-5">
        <div className="flex flex-col items-center">
          <div className="h-16 w-16 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100">
            {myTeamLogo ? (
              <img 
                src={myTeamLogo} 
                alt="Your team" 
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = "/default-avatar.png";
                }}
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-purple-100 text-purple-700 font-bold text-lg">
                You
              </div>
            )}
          </div>
        </div>
        
        <div className="mx-3 text-gray-500 font-medium">
          vs
        </div>
        
        <div className="flex flex-col items-center">
          <div className="h-16 w-16 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100">
            {opponentLogo ? (
              <img 
                src={opponentLogo} 
                alt={opponentName} 
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = "/default-avatar.png";
                }}
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-gray-200 text-gray-700 font-bold text-lg">
                {opponentName.charAt(0)}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* W-L-T Record - Improved spacing and sizing */}
      <div className="bg-gray-50 rounded-full py-4 px-6 flex justify-center items-center mx-auto mb-5 w-full">
        <div className="flex items-center justify-center">
          <span className="text-4xl font-bold text-green-600">{wins}</span>
        </div>
        <div className="w-px h-12 bg-gray-300 mx-5"></div>
        <div className="flex items-center justify-center">
          <span className="text-4xl font-bold text-red-500">{losses}</span>
        </div>
        <div className="w-px h-12 bg-gray-300 mx-5"></div>
        <div className="flex items-center justify-center">
          <span className="text-4xl font-bold text-gray-500">{ties}</span>
        </div>
      </div>
      
      <button 
        onClick={onViewAllClick}
        className="mt-auto text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center"
      >
        View Full Matchup →
      </button>
    </div>
  );
} 