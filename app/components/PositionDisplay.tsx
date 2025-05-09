import React from 'react';
import { PositionDisplayProps } from '../types/ui';

// This component displays a position label with appropriate styling
// Different from the original implementation which was for position selection
const PositionDisplay: React.FC<PositionDisplayProps> = ({ position, size = 'md', className = '' }) => {
  // Position color mapping
  const positionColorMap: Record<string, string> = {
    'C': 'bg-red-100 text-red-800',
    '1B': 'bg-blue-100 text-blue-800',
    '2B': 'bg-green-100 text-green-800',
    '3B': 'bg-purple-100 text-purple-800',
    'SS': 'bg-indigo-100 text-indigo-800',
    'OF': 'bg-yellow-100 text-yellow-800',
    'SP': 'bg-orange-100 text-orange-800',
    'RP': 'bg-pink-100 text-pink-800',
    'P': 'bg-gray-100 text-gray-800',
    'UTIL': 'bg-gray-100 text-gray-700',
    'BN': 'bg-gray-100 text-gray-600',
    'IL': 'bg-red-100 text-red-700',
    'NA': 'bg-gray-100 text-gray-500',
    // Default
    'default': 'bg-gray-100 text-gray-800',
  };

  // Size mapping
  const sizeClasses = {
    'sm': 'text-xs px-1.5 py-0.5',
    'md': 'text-sm px-2 py-1', 
    'lg': 'text-base px-3 py-1.5'
  };

  // Get color class or use default
  const colorClass = positionColorMap[position] || positionColorMap.default;
  const sizeClass = sizeClasses[size] || sizeClasses.md;

  return (
    <span className={`inline-block font-medium rounded ${colorClass} ${sizeClass} ${className}`}>
      {position}
    </span>
  );
};

export default PositionDisplay; 