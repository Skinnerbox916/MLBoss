import React, { useMemo } from 'react';
import { HiChartBar } from 'react-icons/hi';
import { CategoryStat, GroupedStats, processCategoryStats, groupCategoriesByType } from '@/app/utils/stats';

interface CategoryTrackerProps {
  categories: CategoryStat[];
  isSmall?: boolean;
  showViewAllLink?: boolean;
  onViewAllClick?: () => void;
  title?: string;
  loading?: boolean;
}

const CategoryTracker: React.FC<CategoryTrackerProps> = ({
  categories = [],
  isSmall = false,
  showViewAllLink = true,
  onViewAllClick,
  title = "Category Tracker",
  loading = false
}) => {
  // Process all categories to add delta values
  const processedCategories = useMemo(() => {
    return processCategoryStats(categories);
  }, [categories]);
  
  // Group categories into batting and pitching
  const groupedStats = useMemo(() => {
    return groupCategoriesByType(processedCategories);
  }, [processedCategories]);
  
  const { batting, pitching } = groupedStats;
  
  // Get 3 most important categories for each group when in small mode
  const getHighlightedStats = (group: CategoryStat[], count: number = 3) => {
    // Priority order for batting stats
    const battingPriority = ['HR', 'RBI', 'SB', 'R', 'AVG', 'OPS', 'TB'];
    // Priority order for pitching stats
    const pitchingPriority = ['ERA', 'K', 'SO', 'W', 'SV', 'WHIP', 'QS'];
    
    const priority = group === batting ? battingPriority : pitchingPriority;
    
    // First include categories in priority order
    const ordered: CategoryStat[] = [];
    for (const catName of priority) {
      const found = group.find(c => c.name === catName);
      if (found && !ordered.includes(found)) {
        ordered.push(found);
      }
      if (ordered.length >= count) break;
    }
    
    // If we don't have enough, add any remaining categories
    if (ordered.length < count) {
      for (const cat of group) {
        if (!ordered.includes(cat)) {
          ordered.push(cat);
        }
        if (ordered.length >= count) break;
      }
    }
    
    return ordered.slice(0, count);
  };
  
  // Select stats to display based on mode
  const displayedBatting = isSmall ? getHighlightedStats(batting) : batting;
  const displayedPitching = isSmall ? getHighlightedStats(pitching) : pitching;
  
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-6 w-6 bg-gray-200 rounded-full"></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col space-y-2">
            <div className="h-5 bg-gray-200 rounded w-1/2 mx-auto"></div>
            {[1, 2, 3].map(i => (
              <div key={i} className="flex justify-between items-center p-2 rounded bg-gray-100">
                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              </div>
            ))}
          </div>
          <div className="flex flex-col space-y-2">
            <div className="h-5 bg-gray-200 rounded w-1/2 mx-auto"></div>
            {[1, 2, 3].map(i => (
              <div key={i} className="flex justify-between items-center p-2 rounded bg-gray-100">
                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              </div>
            ))}
          </div>
        </div>
        {showViewAllLink && (
          <div className="h-5 bg-gray-200 rounded w-1/3 mx-auto mt-3"></div>
        )}
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-700">{title}</h2>
        <HiChartBar className="h-6 w-6 text-purple-600" />
      </div>
      
      <div className="grid grid-cols-2 gap-2 mt-auto mb-auto flex-1">
        {/* Batting Stats */}
        <div className="flex flex-col space-y-1">
          <div className="text-xs font-medium text-gray-500 uppercase text-center bg-gray-50 py-1 rounded">
            Batting
          </div>
          {displayedBatting.map((stat, index) => (
            <div key={index} className="flex justify-between items-center p-1 rounded bg-gray-100 border-l-4 border-blue-400">
              <span className="text-xs font-medium text-gray-700">{stat.name}</span>
              <span className={`text-xs font-bold ${
                stat.delta && stat.delta > 0 ? 'text-green-600' : 
                stat.delta && stat.delta < 0 ? 'text-red-600' : 
                'text-gray-600'
              }`}>
                {stat.delta && stat.delta > 0 ? '+' : ''}
                {stat.delta ? 
                  (stat.name === 'AVG' || stat.name === 'OPS' ? stat.delta.toFixed(3).replace(/^0+/, '') : stat.delta) 
                  : '0'}
              </span>
            </div>
          ))}
        </div>
        
        {/* Pitching Stats */}
        <div className="flex flex-col space-y-1">
          <div className="text-xs font-medium text-gray-500 uppercase text-center bg-gray-50 py-1 rounded">
            Pitching
          </div>
          {displayedPitching.map((stat, index) => (
            <div key={index} className="flex justify-between items-center p-1 rounded bg-gray-100 border-l-4 border-red-400">
              <span className="text-xs font-medium text-gray-700">{stat.name}</span>
              <span className={`text-xs font-bold ${
                stat.delta && stat.delta > 0 ? 'text-green-600' : 
                stat.delta && stat.delta < 0 ? 'text-red-600' : 
                'text-gray-600'
              }`}>
                {stat.delta && stat.delta > 0 ? '+' : ''}
                {stat.delta ? 
                  (stat.name === 'ERA' || stat.name === 'WHIP' ? stat.delta.toFixed(2) : stat.delta) 
                  : '0'}
              </span>
            </div>
          ))}
        </div>
      </div>
      
      {showViewAllLink && (
        <button 
          onClick={onViewAllClick} 
          className="mt-3 text-sm text-purple-600 font-medium hover:text-purple-800 w-full text-center"
        >
          View All Stats →
        </button>
      )}
    </div>
  );
};

export default CategoryTracker; 