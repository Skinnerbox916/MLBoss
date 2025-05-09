import React, { useState, useEffect } from 'react';
import { CategoryStat, processCategoryStats, groupCategoriesByType } from '@/app/utils/stats';

interface MatchupProps {
  week: string | number;
  opponentName: string;
  opponentLogo?: string;
  myTeamLogo?: string;
  myScore?: string | number;
  opponentScore?: string | number;
  categories?: CategoryStat[];
  isLoading?: boolean;
}

export const SkeletonMatchup: React.FC = () => {
  return (
    <div className="bg-white rounded-lg shadow animate-pulse">
      {/* Matchup header skeleton */}
      <div className="p-4 border-b border-gray-200">
        <div className="h-4 bg-gray-200 rounded w-48 mb-3"></div>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-6 bg-gray-200 rounded w-12"></div>
            <div className="mx-2 bg-gray-200 rounded w-6"></div>
            <div className="w-8 h-8 rounded-full mr-2 bg-gray-200"></div>
            <div className="h-6 bg-gray-200 rounded w-28"></div>
          </div>
          <div className="flex items-center">
            <div className="h-8 bg-gray-200 rounded w-16"></div>
            <div className="mx-2 bg-gray-200 rounded w-4"></div>
            <div className="h-8 bg-gray-200 rounded w-16"></div>
            <div className="ml-3 bg-gray-200 rounded w-20 h-5"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function to safely parse a value that could be string or number
const parseValue = (value: string | number): number => {
  if (typeof value === 'number') return value;
  return parseFloat(value) || 0;
};

// Helper function to safely stringify a value for display
const stringifyValue = (value: string | number): string => {
  return String(value);
};

const MatchupDisplay: React.FC<MatchupProps> = ({
  week,
  opponentName,
  opponentLogo,
  myTeamLogo,
  myScore,
  opponentScore,
  categories = [],
  isLoading = false
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // Process categories the same way as the dashboard
  const processedCategories = categories.length > 0 ? processCategoryStats(categories) : [];
  const { batting: battingCategories, pitching: pitchingCategories } = groupCategoriesByType(processedCategories);
  
  useEffect(() => {
    // Full dump of all categories with detailed info
    if (categories && categories.length > 0) {
      console.log('MatchupDisplay: All categories with details:', 
        categories.map(cat => ({
          name: cat.name,
          displayName: cat.displayName,
          id: cat.id,
          myStat: cat.myStat,
          opponentStat: cat.opponentStat,
          isHigherBetter: cat.isHigherBetter
        }))
      );
      
      // Specifically log strikeout-related categories
      const strikeoutCats = categories.filter(cat => 
        cat.name === 'K' || 
        cat.name === 'SO' || 
        cat.displayName === 'Strikeouts' || 
        cat.displayName === 'Batter Ks' ||
        cat.displayName === 'Pitcher Ks' ||
        cat.displayName?.includes('K')
      );
      
      console.log('MatchupDisplay: Strikeout categories:', strikeoutCats);
    }
    
    if (!categories || categories.length === 0) {
      console.log('MatchupDisplay: No categories data available');
    }
  }, [categories]);

  // Function to get background color based on winning status
  const getCategoryColor = (winning: boolean | null) => {
    if (winning === true) return 'bg-green-100 text-green-800 border-green-200';
    if (winning === false) return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  // Check if we have valid categories data
  const hasValidCategoryData = Array.isArray(processedCategories) && processedCategories.length > 0;
  
  // Calculate wins, losses, and ties using processed categories
  const counters = {
    wins: 0,
    losses: 0,
    ties: 0
  };
  
  processedCategories.forEach(cat => {
    if (cat.winning === true) counters.wins++;
    else if (cat.winning === false) counters.losses++;
    else if (cat.winning === null) counters.ties++;
  });

  // If skeleton loading state is requested, return skeleton UI
  if (isLoading) {
    return <SkeletonMatchup />;
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      {/* Matchup header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Current Matchup {week ? `(Week ${week})` : ''}</h2>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100 flex items-center justify-center">
              {myTeamLogo ? (
                <img 
                  src={myTeamLogo} 
                  alt="Your team" 
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = "/default-avatar.png";
                  }}
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center bg-purple-100 text-purple-700 font-bold text-lg">
                  You
                </div>
              )}
            </div>
            <h3 className="ml-3 font-semibold text-lg">Your Team</h3>
          </div>
          
          <div className="text-gray-600 font-semibold">vs</div>
          
          <div className="flex items-center">
            <h3 className="mr-3 font-semibold text-lg text-right">{opponentName}</h3>
            <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100 flex items-center justify-center">
              {opponentLogo ? (
                <img 
                  src={opponentLogo} 
                  alt={opponentName} 
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = "/default-avatar.png";
                  }}
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center bg-gray-200 text-gray-700 font-bold text-lg">
                  {opponentName.charAt(0)}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Score and record - Updated to match dashboard style */}
        <div className="mt-4 mb-5">
          <div className="bg-gray-50 rounded-full py-4 px-6 flex justify-center items-center mx-auto w-full">
            <div className="flex items-center justify-center">
              <span className="text-4xl font-bold text-green-600">{counters.wins}</span>
            </div>
            <div className="w-px h-12 bg-gray-300 mx-5"></div>
            <div className="flex items-center justify-center">
              <span className="text-4xl font-bold text-red-500">{counters.losses}</span>
            </div>
            <div className="w-px h-12 bg-gray-300 mx-5"></div>
            <div className="flex items-center justify-center">
              <span className="text-4xl font-bold text-gray-500">{counters.ties}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Category sections */}
      {hasValidCategoryData ? (
        <div>
          {/* Batting Section */}
          <div>
            <h3 className="px-4 pt-4 font-semibold text-lg text-gray-700">Batting</h3>
            <div className="px-4 pb-2">
              {/* Split batting categories into two rows */}
              {(() => {
                // Calculate the midpoint for two roughly equal rows
                const halfwayPoint = Math.ceil(battingCategories.length / 2);
                const firstRowCats = battingCategories.slice(0, halfwayPoint);
                const secondRowCats = battingCategories.slice(halfwayPoint);
                
                // Function to render a stat card
                const renderStatCard = (cat: CategoryStat) => {
                  // Determine style based on winning status
                  const categoryColor = getCategoryColor(cat.winning);
                  
                  // Format display value
                  let diffDisplay = '';
                  if (cat.delta === 0) {
                    diffDisplay = 'TIE';
                  } else if (cat.delta !== undefined) {
                    // Add plus sign for positive values
                    const sign = cat.delta > 0 ? '+' : '';
                    
                    // Format based on stat type
                    if (cat.name === 'AVG' || cat.name === 'OPS') {
                      // Format batting averages with 3 decimal places, remove leading zeros
                      diffDisplay = sign + parseFloat(cat.delta.toFixed(3)).toString().replace(/^0\./, '.');
                    } else if (cat.name === 'ERA' || cat.name === 'WHIP') {
                      // Format ERA/WHIP with 2 decimal places
                      diffDisplay = sign + cat.delta.toFixed(2);
                    } else {
                      // Standard format for other stats
                      diffDisplay = sign + cat.delta;
                    }
                  }
                  
                  return (
                    <div key={`batting-${cat.name}`} 
                         className={`border rounded-lg p-3 ${categoryColor}`}>
                      <div className="text-center font-semibold">
                        {cat.displayName || cat.name}
                      </div>
                      <div className="text-center font-bold text-lg">
                        {diffDisplay}
                      </div>
                      <div className="text-center text-xs mt-1">
                        {String(cat.myStat)} vs {String(cat.opponentStat)}
                      </div>
                    </div>
                  );
                };
                
                return (
                  <>
                    {/* First row of batting stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-3">
                      {firstRowCats.map(renderStatCard)}
                    </div>
                    
                    {/* Second row of batting stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {secondRowCats.map(renderStatCard)}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          
          {/* Pitching Section */}
          <div>
            <h3 className="px-4 pt-4 font-semibold text-lg text-gray-700">Pitching</h3>
            <div className="px-4 pb-4">
              {/* Split pitching categories into two rows */}
              {(() => {
                // Calculate the midpoint for two roughly equal rows
                const halfwayPoint = Math.ceil(pitchingCategories.length / 2);
                const firstRowCats = pitchingCategories.slice(0, halfwayPoint);
                const secondRowCats = pitchingCategories.slice(halfwayPoint);
                
                // Function to render a stat card
                const renderStatCard = (cat: CategoryStat) => {
                  // Determine style based on winning status
                  const categoryColor = getCategoryColor(cat.winning);
                  
                  // Format display value
                  let diffDisplay = '';
                  if (cat.delta === 0) {
                    diffDisplay = 'TIE';
                  } else if (cat.delta !== undefined) {
                    // Add plus sign for positive values
                    const sign = cat.delta > 0 ? '+' : '';
                    
                    // Format based on stat type
                    if (cat.name === 'ERA' || cat.name === 'WHIP') {
                      // Format ERA/WHIP with 2 decimal places
                      diffDisplay = sign + cat.delta.toFixed(2);
                    } else {
                      // Standard format for other stats
                      diffDisplay = sign + cat.delta;
                    }
                  }
                  
                  return (
                    <div key={`pitching-${cat.name}`} 
                         className={`border rounded-lg p-3 ${categoryColor}`}>
                      <div className="text-center font-semibold">
                        {cat.displayName || cat.name}
                      </div>
                      <div className="text-center font-bold text-lg">
                        {diffDisplay}
                      </div>
                      <div className="text-center text-xs mt-1">
                        {String(cat.myStat)} vs {String(cat.opponentStat)}
                      </div>
                    </div>
                  );
                };
                
                return (
                  <>
                    {/* First row of pitching stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-3">
                      {firstRowCats.map(renderStatCard)}
                    </div>
                    
                    {/* Second row of pitching stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {secondRowCats.map(renderStatCard)}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : (
        // No data state
        <div className="p-8 text-center">
          <p className="text-gray-500">No matchup data available for this week.</p>
        </div>
      )}
    </div>
  );
};

export default MatchupDisplay; 
