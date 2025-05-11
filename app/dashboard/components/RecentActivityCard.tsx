import React from 'react';
import { HiRefresh } from 'react-icons/hi';

interface ActivityItem {
  type: 'add' | 'drop' | 'trade';
  player?: string;
  team?: string;
  timestamp: string;
}

interface RecentActivityCardProps {
  activities: ActivityItem[];
  onViewAllClick?: () => void;
}

export default function RecentActivityCard({
  activities,
  onViewAllClick
}: RecentActivityCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <HiRefresh className="h-6 w-6 text-green-600" />
        <h2 className="text-lg font-semibold text-gray-700">Recent Activity</h2>
      </div>
      <div className="space-y-4">
        {activities.map((activity, index) => (
          <div key={index} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-start">
              <div className={`mt-1 h-4 w-4 rounded-full flex-shrink-0 ${
                activity.type === 'add' ? 'bg-green-100' : 
                activity.type === 'drop' ? 'bg-red-100' : 'bg-blue-100'
              }`}>
                <span className={`block h-2 w-2 rounded-full mx-auto mt-1 ${
                  activity.type === 'add' ? 'bg-green-500' : 
                  activity.type === 'drop' ? 'bg-red-500' : 'bg-blue-500'
                }`}></span>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-800">
                  {activity.type === 'add' && 'Added'} 
                  {activity.type === 'drop' && 'Dropped'} 
                  {activity.type === 'trade' && 'Traded with'}
                  {' '}
                  <span className="font-semibold">
                    {activity.player || activity.team}
                  </span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{activity.timestamp}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button 
        onClick={onViewAllClick}
        className="mt-4 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center"
      >
        View All Activity →
      </button>
    </div>
  );
} 