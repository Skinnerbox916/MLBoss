import React, { useState, useEffect } from 'react';

interface CategoryStat {
  name: string;
  displayName: string;
  id?: string;
  myStat: string;
  opponentStat: string;
  winning: boolean | null;
  isHigherBetter?: boolean;
}

interface MatchupProps {
  week: string | number;
  opponentName: string;
  opponentLogo?: string;
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

const MatchupDisplay: React.FC<MatchupProps> = ({
  week,
  opponentName,
  opponentLogo,
  myScore,
  opponentScore,
  categories = [],
  isLoading = false
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  
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
  const hasValidCategoryData = Array.isArray(categories) && categories.length > 0;

  // Filter out non-scoring categories like H/AB
  const scoringCategories = categories.filter(cat => cat.name !== 'H/AB');
  
  // Calculate wins, losses, and ties
  // We should only count categories that are displayed in the UI
  // This means battingCategories + pitcherStrikeouts[0] + pitchingCategories (processed)
  // First, process all categories

  // Process and categorize strikeouts properly
  // Iterate through all categories to identify and classify strikeout categories
  let batterStrikeouts: CategoryStat[] = [];
  let pitcherStrikeouts: CategoryStat[] = [];
  
  // First pass: Find exact matches for batter and pitcher Ks
  scoringCategories.forEach(cat => {
    // Check for exact explicit matches first
    if (cat.displayName === 'Batter Ks' || 
        (cat.name === 'K' && cat.isHigherBetter === false)) {
      batterStrikeouts.push(cat);
    }
    else if (cat.displayName === 'Pitcher Ks' || 
             cat.name === 'SO' ||
             (cat.name === 'K' && cat.isHigherBetter === true)) {
      pitcherStrikeouts.push(cat);
    }
  });
  
  console.log('MatchupDisplay: First pass - batter Ks:', batterStrikeouts.length, 'pitcher Ks:', pitcherStrikeouts.length);
  
  // Second pass: If we're missing one type, look for generic K categories
  if (batterStrikeouts.length === 0 || pitcherStrikeouts.length === 0) {
    const unclassifiedKs = scoringCategories.filter(cat => 
      (cat.name === 'K' || cat.name === 'SO' || cat.displayName === 'Strikeouts' || cat.displayName?.includes('K')) && 
      !batterStrikeouts.includes(cat) && 
      !pitcherStrikeouts.includes(cat)
    );
    
    console.log('MatchupDisplay: Unclassified K categories:', unclassifiedKs);
    
    // If we have exactly two unclassified K categories and we're missing both types
    if (unclassifiedKs.length === 2 && batterStrikeouts.length === 0 && pitcherStrikeouts.length === 0) {
      // Determine which is which based on index or id if available
      // Lower index/id is usually batter Ks, higher is pitcher Ks
      const sorted = [...unclassifiedKs].sort((a, b) => {
        if (a.id && b.id) return parseInt(a.id) - parseInt(b.id);
        return scoringCategories.indexOf(a) - scoringCategories.indexOf(b);
      });
      
      // First one is batter Ks (lower is better)
      const myStat1 = parseFloat(sorted[0].myStat) || 0;
      const opponentStat1 = parseFloat(sorted[0].opponentStat) || 0;
      const winning1 = myStat1 < opponentStat1 ? true : myStat1 > opponentStat1 ? false : null;
      
      batterStrikeouts.push({
        ...sorted[0],
        displayName: 'Batter Ks',
        winning: winning1,
        isHigherBetter: false
      });
      
      // Second one is pitcher Ks (higher is better)
      pitcherStrikeouts.push({
        ...sorted[1],
        displayName: 'Pitcher Ks',
        isHigherBetter: true
      });
    }
    // If we have one unclassified K category
    else if (unclassifiedKs.length === 1) {
      if (batterStrikeouts.length === 0) {
        // Need batter Ks
        const myStat = parseFloat(unclassifiedKs[0].myStat) || 0;
        const opponentStat = parseFloat(unclassifiedKs[0].opponentStat) || 0;
        const winning = myStat < opponentStat ? true : myStat > opponentStat ? false : null;
        
        batterStrikeouts.push({
          ...unclassifiedKs[0],
          displayName: 'Batter Ks',
          winning,
          isHigherBetter: false
        });
      } else {
        // Need pitcher Ks
        const myStat = parseFloat(unclassifiedKs[0].myStat) || 0;
        const opponentStat = parseFloat(unclassifiedKs[0].opponentStat) || 0;
        const winning = myStat > opponentStat ? true : myStat < opponentStat ? false : null;
        
        pitcherStrikeouts.push({
          ...unclassifiedKs[0],
          displayName: 'Pitcher Ks',
          winning,
          isHigherBetter: true
        });
      }
    }
  }
  
  // Final fallback: If we still don't have both types, create them from default values
  if (batterStrikeouts.length === 0) {
    console.log('MatchupDisplay: Creating default batter Ks');
    batterStrikeouts.push({
      name: 'K',
      displayName: 'Batter Ks',
      id: '7',
      myStat: '0',
      opponentStat: '0',
      winning: null,
      isHigherBetter: false
    });
  }
  
  if (pitcherStrikeouts.length === 0) {
    console.log('MatchupDisplay: Creating default pitcher Ks');
    pitcherStrikeouts.push({
      name: 'SO',
      displayName: 'Pitcher Ks',
      id: '10',
      myStat: '0',
      opponentStat: '0',
      winning: null,
      isHigherBetter: true
    });
  }
  
  console.log('MatchupDisplay: Final - batter Ks:', batterStrikeouts[0], 'pitcher Ks:', pitcherStrikeouts[0]);
  
  // Get all batting categories in their original order
  const battingCategories = scoringCategories.filter(cat => 
    ['R', 'H', 'HR', 'RBI', 'SB', 'BB', 'AVG', 'OBP', 'SLG', 'OPS', 'TB', 'K'].includes(cat.name) &&
    !pitcherStrikeouts.includes(cat)
  ).map(cat => {
    // If this is the batter strikeout category, update its display name and winning status
    if (cat === batterStrikeouts[0]) {
      return {
        ...cat,
        displayName: 'Batter Ks',
        winning: cat.winning,
        isHigherBetter: false
      };
    }
    return cat;
  });
  
  // Get all pitching categories in their original order
  const pitchingCategories = scoringCategories.filter(cat => 
    ['W', 'SV', 'ERA', 'WHIP', 'QS', 'IP', 'BS', 'HD', 'SO', 'K'].includes(cat.name) &&
    !batterStrikeouts.includes(cat)
  ).map(cat => {
    // If this is the pitcher strikeout category, update its display name
    if (cat === pitcherStrikeouts[0]) {
      return {
        ...cat,
        displayName: 'Pitcher Ks',
        isHigherBetter: true
      };
    }
    // For ERA and WHIP, ensure lower is better
    if (cat.name === 'ERA' || cat.name === 'WHIP') {
      const myStat = parseFloat(cat.myStat) || 0;
      const opponentStat = parseFloat(cat.opponentStat) || 0;
      const winning = myStat < opponentStat ? true : myStat > opponentStat ? false : null;
      
      return {
        ...cat,
        winning,
        isHigherBetter: false
      };
    }
    return cat;
  });

  // Now calculate wins, losses, and ties based on all displayed categories
  const allDisplayedCategories = [...battingCategories, ...pitchingCategories];
  
  const wins = allDisplayedCategories.filter(cat => cat.winning === true).length;
  const losses = allDisplayedCategories.filter(cat => cat.winning === false).length;
  const ties = allDisplayedCategories.filter(cat => cat.winning === null).length;
  
  if (isLoading) {
    return <SkeletonMatchup />;
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Matchup header */}
      <div className="p-4 border-b border-gray-200 relative overflow-visible">
        {/* Card Title and Week, above the row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <span className="text-xl font-bold text-gray-800">Current Matchup</span>
            <span className="ml-2 text-sm font-semibold text-gray-500">(Week {week || '-'})</span>
          </div>
          {hasValidCategoryData && (
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-500 hover:text-gray-700 transition-colors flex items-center justify-center ml-2"
              aria-expanded={isExpanded}
              title={isExpanded ? "Collapse categories" : "Expand categories"}
              style={{ height: '36px', width: '36px' }}
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className={`h-6 w-6 transition-transform duration-200 ${isExpanded ? 'transform rotate-180' : ''}`} 
                viewBox="0 0 20 20" 
                fill="currentColor"
              >
                <path 
                  fillRule="evenodd" 
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" 
                  clipRule="evenodd" 
                />
              </svg>
            </button>
          )}
        </div>
        {/* Scoreboard floating in the red box area */}
        <div className="relative h-0">
          <div className="absolute left-1/2 -translate-x-1/2 -top-7 z-10">
            <div className="flex items-end bg-white/80 rounded-xl shadow px-6 py-2 border border-gray-200 min-w-[190px]">
              <div className="flex flex-col items-center mx-3">
                <span className="text-green-600 text-3xl font-extrabold drop-shadow">{wins}</span>
                <span className="text-sm font-semibold tracking-wide text-gray-500 mt-1">W</span>
              </div>
              <span className="text-2xl text-gray-300 font-extrabold mx-2 select-none" aria-hidden="true">|</span>
              <div className="flex flex-col items-center mx-3">
                <span className="text-red-600 text-3xl font-extrabold drop-shadow">{losses}</span>
                <span className="text-sm font-semibold tracking-wide text-gray-500 mt-1">L</span>
              </div>
              <span className="text-2xl text-gray-300 font-extrabold mx-2 select-none" aria-hidden="true">|</span>
              <div className="flex flex-col items-center mx-3">
                <span className="text-gray-600 text-3xl font-extrabold drop-shadow">{ties}</span>
                <span className="text-sm font-semibold tracking-wide text-gray-500 mt-1">T</span>
              </div>
            </div>
          </div>
        </div>
        {/* Team names and Scoreboard in a single row */}
        <div className="flex items-center justify-between gap-4 mt-6">
          {/* Team names left-aligned */}
          <div className="flex items-center flex-shrink-0">
            <span className="font-semibold text-lg">You</span>
            <span className="mx-2 text-gray-500">vs</span>
            {opponentLogo && (
              <img src={opponentLogo} alt="Opponent Logo" className="w-8 h-8 rounded-full mr-2" />
            )}
            <span className="font-semibold text-lg">{opponentName || '-'}</span>
          </div>
          {/* (No scoreboard here, it's floating above) */}
        </div>
      </div>

      {/* Categories display */}
      {hasValidCategoryData && isExpanded ? (
        <div className="p-4 space-y-4">
          {/* Batting categories */}
          {battingCategories.length > 0 && (
            <>
              <div className="text-sm font-medium text-gray-600 border-b pb-1">Batting</div>
              <div className="flex flex-wrap gap-3 pb-2">
                {battingCategories.map((cat, index) => {
                  let delta = '';
                  const my = parseFloat(cat.myStat);
                  const opp = parseFloat(cat.opponentStat);
                  if (!isNaN(my) && !isNaN(opp)) {
                    if (cat.winning === null) {
                      delta = 'TIE';
                    } else {
                      const diff = my - opp;
                      const sign = diff > 0 ? '+' : '';
                      if (cat.name === 'AVG') {
                        delta = sign + diff.toFixed(3);
                      } else if (cat.name === 'ERA' || cat.name === 'WHIP') {
                        delta = sign + diff.toFixed(2);
                      } else {
                        delta = sign + diff.toFixed(2).replace(/\.00$/, '');
                      }
                    }
                  }
                  const displayName = cat.displayName === 'Batter Ks' ? 'Ks' : cat.displayName;
                  return (
                    <button
                      key={`batting-${index}`}
                      className={`flex-1 flex flex-col items-center p-2 rounded-lg border text-xs font-medium transition-colors shadow-sm
                        ${getCategoryColor(cat.winning)} ${selectedCategory === cat.name ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === cat.name ? null : cat.name)}
                      style={{lineHeight: 1.2}}
                    >
                      <span className="font-bold mb-1 text-base text-gray-800 tracking-wide">{displayName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-sm font-bold mb-1
                        ${cat.winning === true ? 'bg-green-100 text-green-700' : cat.winning === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{delta}</span>
                      <span className="text-[10px] text-gray-400">{cat.myStat} vs {cat.opponentStat}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          
          {/* Pitching categories */}
          {pitchingCategories.length > 0 && (
            <>
              <div className="text-sm font-medium text-gray-600 border-b pb-1 mt-4">Pitching</div>
              <div className="flex flex-wrap gap-3 pb-2">
                {pitchingCategories.map((cat, index) => {
                  let delta = '';
                  const my = parseFloat(cat.myStat);
                  const opp = parseFloat(cat.opponentStat);
                  if (!isNaN(my) && !isNaN(opp)) {
                    if (cat.winning === null) {
                      delta = 'TIE';
                    } else {
                      const diff = my - opp;
                      const sign = diff > 0 ? '+' : '';
                      if (cat.name === 'AVG') {
                        delta = sign + diff.toFixed(3);
                      } else if (cat.name === 'ERA' || cat.name === 'WHIP') {
                        delta = sign + diff.toFixed(2);
                      } else {
                        delta = sign + diff.toFixed(2).replace(/\.00$/, '');
                      }
                    }
                  }
                  const displayName = cat.displayName === 'Pitcher Ks' ? 'Ks' : cat.displayName;
                  return (
                    <button
                      key={`pitching-${index}`}
                      className={`flex-1 flex flex-col items-center p-2 rounded-lg border text-xs font-medium transition-colors shadow-sm
                        ${getCategoryColor(cat.winning)} ${selectedCategory === cat.name ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === cat.name ? null : cat.name)}
                      style={{lineHeight: 1.2}}
                    >
                      <span className="font-bold mb-1 text-base text-gray-800 tracking-wide">{displayName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-sm font-bold mb-1
                        ${cat.winning === true ? 'bg-green-100 text-green-700' : cat.winning === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{delta}</span>
                      <span className="text-[10px] text-gray-400">{cat.myStat} vs {cat.opponentStat}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : !hasValidCategoryData ? (
        <div className="p-4 text-center text-gray-500">
          No category data available
        </div>
      ) : null}
    </div>
  );
};

export default MatchupDisplay; 