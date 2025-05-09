import React from 'react';
import { HiOutlineUserGroup } from 'react-icons/hi';
import { CategoryStat } from '@/app/utils/stats';

const StatItem = ({ stat }: { stat: CategoryStat }) => (
  <div className={`flex justify-between items-center px-2 py-1 rounded-md border transition-colors
    ${stat.winning === true ? 'bg-green-50 border-green-200' : 
      stat.winning === false ? 'bg-red-50 border-red-200' : 
      'bg-gray-50 border-gray-100'}
    text-xs font-medium`} style={{ minHeight: '2rem' }}>
    <span className="text-gray-700 w-10 text-left">{stat.name}</span>
    <span className={`w-10 text-right font-bold
      ${stat.winning === true ? 'text-green-700' : 
        stat.winning === false ? 'text-red-700' : 
        'text-gray-600'}
    `}>
      {stat.delta === 0 ? '0' : 
        (stat.delta && stat.delta > 0 ? '+' : '') + 
        (stat.name === 'AVG' || stat.name === 'OPS' ? 
          parseFloat(stat.delta?.toFixed(3) || '0').toString().replace(/^0\./, '.') : 
          stat.name === 'ERA' || stat.name === 'WHIP' ? 
            stat.delta?.toFixed(2) : 
            stat.delta
        )
      }
    </span>
  </div>
);

export default function BattingCategoryCard({ categories, onViewAllClick, showViewAllLink = true, loading = false }: { categories: CategoryStat[], onViewAllClick?: () => void, showViewAllLink?: boolean, loading?: boolean }) {
  if (loading) return <div className="bg-white rounded-lg shadow-md p-4 animate-pulse h-full" />;
  // Split into two columns for layout
  const midpoint = Math.ceil(categories.length / 2);
  const col1 = categories.slice(0, midpoint);
  const col2 = categories.slice(midpoint);
  return (
    <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <HiOutlineUserGroup className="h-6 w-6 text-blue-500" />
        <h2 className="text-lg font-semibold text-gray-700">Batting</h2>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-auto flex-1">
        <div className="space-y-2 flex flex-col">{col1.map((stat, i) => <StatItem key={i} stat={stat} />)}</div>
        <div className="space-y-2 flex flex-col">{col2.map((stat, i) => <StatItem key={i} stat={stat} />)}</div>
      </div>
      {showViewAllLink && (
        <button onClick={onViewAllClick} className="mt-2 text-sm text-purple-600 font-medium hover:text-purple-800 w-full text-center">View All Stats →</button>
      )}
    </div>
  );
} 