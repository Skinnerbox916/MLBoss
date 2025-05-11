import React from 'react';
import { HiChartBar } from 'react-icons/hi';

interface WaiversCardProps {
  priority: number;
  weeklyAdds: number;
  weeklyLimit: number;
}

export default function WaiversCard({
  priority,
  weeklyAdds,
  weeklyLimit
}: WaiversCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <HiChartBar className="h-6 w-6 text-indigo-600" />
        <h2 className="text-lg font-semibold text-gray-700">Waivers</h2>
      </div>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Waiver Priority:</span>
          <span className="font-bold text-gray-900">{priority}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Weekly Adds:</span>
          <span className="font-bold text-gray-900">{weeklyAdds} of {weeklyLimit}</span>
        </div>
        <div className="text-center text-gray-500 pt-4">
          <p className="text-sm">Additional waiver data coming soon</p>
        </div>
      </div>
    </div>
  );
} 