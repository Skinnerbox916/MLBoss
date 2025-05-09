import React from 'react';

interface PositionSelectorProps {
  onPositionSelect: (position: string) => void;
  selectedPosition: string | null;
}

const PositionSelector: React.FC<PositionSelectorProps> = ({ onPositionSelect, selectedPosition }) => {
  const positions = ['C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL', 'SP', 'RP', 'P', 'BN'];
  
  // Position color mapping
  const getPositionColor = (position: string, isSelected: boolean) => {
    if (isSelected) {
      return 'bg-purple-600 text-white';
    }
    
    const colorMap: Record<string, string> = {
      'C': 'bg-red-100 text-red-800 hover:bg-red-200',
      '1B': 'bg-blue-100 text-blue-800 hover:bg-blue-200',
      '2B': 'bg-green-100 text-green-800 hover:bg-green-200',
      '3B': 'bg-purple-100 text-purple-800 hover:bg-purple-200',
      'SS': 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
      'OF': 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
      'SP': 'bg-orange-100 text-orange-800 hover:bg-orange-200',
      'RP': 'bg-pink-100 text-pink-800 hover:bg-pink-200',
      'P': 'bg-gray-100 text-gray-800 hover:bg-gray-200',
      'UTIL': 'bg-gray-100 text-gray-700 hover:bg-gray-200',
      'BN': 'bg-gray-100 text-gray-600 hover:bg-gray-200',
    };
    
    return colorMap[position] || 'bg-gray-100 text-gray-800 hover:bg-gray-200';
  };

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