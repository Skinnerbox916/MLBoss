export function getPositionColor(position: string, isSelected: boolean) {
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
} 