import React from 'react';
import { HiChartBar } from 'react-icons/hi';

interface Category {
  name: string;
  value: string | number;
  winning: boolean;
  delta: string | number;
}

interface CategoryTrackerProps {
  categories: Category[];
  isSmall?: boolean;
  onViewAllClick?: () => void;
  loading?: boolean;
}

export default function CategoryTracker({ 
  categories, 
  isSmall = false,
  onViewAllClick,
  loading = false
}: CategoryTrackerProps) {
  const displayCategories = isSmall 
    ? categories.slice(0, 6) // Show only first 6 categories if small version
    : categories;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-4"></div>
        {Array(isSmall ? 3 : 6).fill(0).map((_, i) => (
          <div key={i} className="flex justify-between items-center mb-3">
            <div className="h-4 bg-gray-200 rounded w-16"></div>
            <div className="h-4 bg-gray-200 rounded w-10"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow-md p-6 ${isSmall ? 'flex flex-col h-full' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-700">Category Tracker</h2>
        <HiChartBar className="h-6 w-6 text-purple-600" />
      </div>
      
      <div className={`${isSmall ? 'flex-1 flex flex-col justify-center' : ''}`}>
        <div className="flex flex-col space-y-2">
          {displayCategories.map((category, index) => (
            <div 
              key={index}
              className={`flex justify-between items-center ${
                index < displayCategories.length - 1 ? 'border-b border-gray-100 pb-2' : ''
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium">{category.name}</span>
                <span 
                  className={`text-xs ${
                    parseFloat(String(category.delta)) > 0 
                      ? 'text-green-600' 
                      : parseFloat(String(category.delta)) < 0 
                        ? 'text-red-600' 
                        : 'text-gray-400'
                  }`}
                >
                  {parseFloat(String(category.delta)) > 0 && '+'}
                  {category.delta}
                </span>
              </div>
              <div className="flex items-center">
                <span 
                  className={`text-sm font-medium ${
                    category.winning ? 'text-green-600' : 'text-gray-600'
                  }`}
                >
                  {category.value}
                </span>
                {category.winning && (
                  <span className="ml-1 text-green-600">•</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {onViewAllClick && (
        <button 
          onClick={onViewAllClick}
          className="mt-3 text-sm text-[#3c1791] font-medium hover:text-[#2a1066] w-full text-center"
        >
          View All Stats →
        </button>
      )}
    </div>
  );
} 