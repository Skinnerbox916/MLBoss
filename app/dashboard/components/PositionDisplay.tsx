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
    <>
      <h2 className="text-xl font-semibold mb-4">Batter Comparisons</h2>
      <div className="flex flex-row space-x-2 overflow-x-auto pb-1 mb-2">
        {POSITIONS.map((position) => (
          <button
            key={position.id}
            onClick={() => onPositionSelect(position.id)}
            className={`p-2 min-w-[44px] rounded-md text-sm font-medium transition-colors
              ${selectedPosition === position.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            {position.id}
          </button>
        ))}
      </div>
    </>
  );
} 