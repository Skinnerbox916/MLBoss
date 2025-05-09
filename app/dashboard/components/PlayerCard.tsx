import React from 'react';
import Image from 'next/image';
import { FaUserCircle } from 'react-icons/fa';

interface PlayerCardProps {
  player: {
    name: string;
    position: string;
    team: string;
    image_url?: string;
    status?: string;
    pitching_today?: boolean;
    matchup?: {
      opponent: string;
      home_away: 'home' | 'away';
      time?: string;
    };
    stats?: {
      [key: string]: string | number;
    };
  };
}

export default function PlayerCard({ player }: PlayerCardProps) {
  const isPitcher = player.position.includes('P');
  
  // Define relevant stats based on player type
  const relevantStats = isPitcher
    ? ['W', 'SV', 'SO', 'ERA', 'WHIP']
    : ['R', 'HR', 'RBI', 'SB', 'AVG', 'OPS'];

  return (
    <div className="bg-white rounded-lg shadow-md p-4 border border-gray-100 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {player.image_url ? (
            <Image
              src={player.image_url}
              alt={player.name}
              width={40}
              height={40}
              className="rounded-full"
            />
          ) : (
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
              <FaUserCircle className="w-8 h-8 text-gray-400" />
            </div>
          )}
          <div>
            <h3 className="font-medium">{player.name}</h3>
            <div className="flex items-center text-sm text-gray-500">
              <span>{player.position}</span>
              <span className="mx-1">•</span>
              <span>{player.team}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end">
          {player.status && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-800">
              {player.status}
            </span>
          )}
          {player.pitching_today && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-800 mt-1">
              Today
            </span>
          )}
        </div>
      </div>

      {/* Matchup Information */}
      {player.matchup && (
        <div className="mb-3 p-2 bg-gray-50 rounded-md">
          <div className="text-sm font-medium text-gray-700">
            vs {player.matchup.opponent}
          </div>
          <div className="text-xs text-gray-500">
            {player.matchup.home_away === 'home' ? 'Home' : 'Away'}
            {player.matchup.time && ` • ${player.matchup.time}`}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {player.stats && (
        <div className="grid grid-cols-3 gap-2">
          {relevantStats.map((stat) => (
            <div key={stat} className="text-center p-1 bg-gray-50 rounded">
              <div className="text-xs text-gray-500">{stat}</div>
              <div className="text-sm font-medium">
                {player.stats?.[stat] || '-'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 