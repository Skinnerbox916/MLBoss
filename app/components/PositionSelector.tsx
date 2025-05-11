import React from 'react';
import { getPositionColor } from './positionUtils';

interface PositionSelectorProps {
  onPositionSelect: (position: string) => void;
  selectedPosition: string | null;
}

const PositionSelector: React.FC<PositionSelectorProps> = ({ onPositionSelect, selectedPosition }) => {
  const positions = ['C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL', 'SP', 'RP', 'P', 'BN'];

  return (
    <div>
      <h3 className="text-md font-medium mb-3">Select Position</h3>
      <div className="flex flex-wrap gap-2">
        {positions.map((position) => (
          <button
            key={position}
            className={`px-3 py-1.5 rounded text-sm font-medium transition ${getPositionColor(position, selectedPosition === position)}`}
            onClick={() => onPositionSelect(position)}
          >
            {position}
          </button>
        ))}
      </div>
    </div>
  );
};

export default PositionSelector; 