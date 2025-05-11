import React from 'react';
import { HiCalendar } from 'react-icons/hi';

interface NextWeekCardProps {
  opponent: string;
  dateRange: string;
  onScheduleAnalysisClick?: () => void;
}

export default function NextWeekCard({
  opponent,
  dateRange,
  onScheduleAnalysisClick
}: NextWeekCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <HiCalendar className="h-6 w-6 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-700">Next Week</h2>
      </div>
      <div className="flex-1 flex flex-col justify-center">
        <div className="text-sm text-gray-700 mb-4">
          <p className="mb-1 font-semibold">{opponent}</p>
          <p className="text-gray-500">{dateRange}</p>
        </div>
        <div className="flex justify-between text-xs text-gray-600">
          <span>Matchup Analysis</span>
          <span>Coming Soon</span>
        </div>
      </div>
      <button 
        onClick={onScheduleAnalysisClick}
        className="mt-3 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center"
      >
        Schedule Analysis →
      </button>
    </div>
  );
} 