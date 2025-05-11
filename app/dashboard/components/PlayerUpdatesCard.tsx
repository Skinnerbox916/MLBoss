import React from 'react';
import { HiBell } from 'react-icons/hi';

interface PlayerUpdate {
  player: string;
  update: string;
  timestamp: string;
}

interface PlayerUpdatesCardProps {
  updates: PlayerUpdate[];
  onViewAllClick?: () => void;
}

export default function PlayerUpdatesCard({
  updates,
  onViewAllClick
}: PlayerUpdatesCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <HiBell className="h-6 w-6 text-orange-500" />
        <h2 className="text-lg font-semibold text-gray-700">Player Updates</h2>
      </div>
      <div className="space-y-4">
        {updates.map((update, index) => (
          <div key={index} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
            <p className="text-sm font-medium text-gray-800">{update.player}</p>
            <p className="text-xs text-gray-600 mt-1">{update.update}</p>
            <p className="text-xs text-gray-500 mt-0.5">{update.timestamp}</p>
          </div>
        ))}
      </div>
      <button 
        onClick={onViewAllClick}
        className="mt-4 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center"
      >
        View All Updates →
      </button>
    </div>
  );
} 