import React from 'react';
import { HiExclamation } from 'react-icons/hi';

interface LineupIssueProps {
  startersWithNoGames: number;
  ilOutOfIlSpot: number;
  dtdStarting: number;
  openSlots: number;
  availableSwaps: number;
  onFixLineupClick?: () => void;
}

export default function LineupIssuesCard({
  startersWithNoGames,
  ilOutOfIlSpot,
  dtdStarting,
  openSlots,
  availableSwaps,
  onFixLineupClick
}: LineupIssueProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <HiExclamation className="h-6 w-6 text-amber-500" />
        <h2 className="text-lg font-semibold text-gray-700">Lineup Issues</h2>
      </div>
      <div className="flex-1 flex flex-col justify-center space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">No games:</span>
          <span className="font-bold text-gray-600">
            {startersWithNoGames}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">IL players starting:</span>
          <span className="font-bold text-gray-600">
            {ilOutOfIlSpot}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">DTD starting:</span>
          <span className="font-bold text-gray-600">
            {dtdStarting}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Open slots:</span>
          <span className="font-bold text-gray-600">
            {openSlots}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Available Swaps:</span>
          <span className="font-bold text-gray-600">
            {availableSwaps}
          </span>
        </div>
      </div>
      <button 
        onClick={onFixLineupClick}
        className="mt-3 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center"
      >
        Fix Lineup Issues →
      </button>
    </div>
  );
} 