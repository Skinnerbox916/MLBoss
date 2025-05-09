import React from 'react';

interface PositionDisplayProps {
  onPositionSelect: (position: string) => void;
  selectedPosition: string | null;
}

const POSITIONS = [
  { id: 'C', label: 'Catcher' },
  { id: '1B', label: 'First Base' },
  { id: '2B', label: 'Second Base' },
  { id: '3B', label: 'Third Base' },
  { id: 'SS', label: 'Shortstop' },
  { id: 'OF', label: 'Outfield' },
  { id: 'UTIL', label: 'Utility' },
];

export default function PositionDisplay({ onPositionSelect, selectedPosition }: PositionDisplayProps) {
  return (
    <div className="flex flex-wrap items-center">
      <span className="text-sm font-medium text-gray-700 mr-3">Position:</span>
      <div className="flex flex-wrap gap-1">
        {POSITIONS.map((position) => (
          <button
            key={position.id}
            onClick={() => onPositionSelect(position.id)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors
              ${selectedPosition === position.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            title={position.label}
          >
            {position.id}
          </button>
        ))}
      </div>
    </div>
  );
} 