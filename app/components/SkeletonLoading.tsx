import React from 'react';

interface SkeletonPlayerProps {
  count?: number;
  isPitcher?: boolean;
}

export const SkeletonPlayer: React.FC<{ isPitcher?: boolean }> = ({ isPitcher = false }) => {
  // Use useEffect and useState to handle client-side rendering of random elements
  const [showStatusBadge, setShowStatusBadge] = React.useState(false);
  const [isRedStatus, setIsRedStatus] = React.useState(false);
  const [showPitchingBadge, setShowPitchingBadge] = React.useState(false);
  
  // Move randomness to useEffect to ensure consistent server/client rendering
  React.useEffect(() => {
    // Only apply randomness on the client side
    setShowStatusBadge(Math.random() > 0.7);
    setIsRedStatus(Math.random() > 0.5);
    if (isPitcher) {
      setShowPitchingBadge(Math.random() > 0.8);
    }
  }, [isPitcher]);

  return (
    <li className="flex items-center text-gray-800 text-sm rounded px-2 py-1.5 animate-pulse">
      <div className="w-7 h-7 rounded-full mr-2 bg-gray-200"></div>
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center flex-wrap">
          <div className="h-4 bg-gray-200 rounded w-32"></div>
          <div className="flex space-x-1 ml-1 flex-wrap">
            {/* Use predefined class names instead of dynamic string concatenation */}
            {showStatusBadge && (
              <div className={`h-4 ${isRedStatus ? 'bg-red-100' : 'bg-yellow-100'} rounded w-10 ml-1`}></div>
            )}
            {/* Show pitching today indicator for pitchers */}
            {isPitcher && showPitchingBadge && (
              <div className="h-4 bg-green-100 rounded w-12 ml-1"></div>
            )}
          </div>
        </div>
        <div className="flex items-center mt-0.5">
          <div className="h-3 bg-gray-200 rounded w-8"></div>
          <div className="mx-1 h-3 bg-gray-200 rounded-full w-1"></div>
          <div className="h-3 bg-gray-200 rounded w-12"></div>
        </div>
      </div>
    </li>
  );
};

export const SkeletonPlayerList: React.FC<SkeletonPlayerProps> = ({ count = 10, isPitcher = false }) => {
  return (
    <ul className="space-y-1">
      {Array(count).fill(0).map((_, index) => (
        <SkeletonPlayer key={index} isPitcher={isPitcher} />
      ))}
    </ul>
  );
};

export const SkeletonTeamInfo: React.FC = () => {
  return (
    <div className="bg-white rounded-lg shadow p-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch h-full">
        {/* Left Column */}
        <div>
          <div className="flex items-center mb-4">
            <div className="w-16 h-16 rounded-full mr-4 bg-gray-200"></div>
            <div>
              <div className="h-8 bg-gray-200 rounded w-48 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-32"></div>
            </div>
          </div>
        </div>
        {/* Right Column */}
        <div className="flex flex-row items-center justify-end h-full gap-8">
          <div className="text-right">
            <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
            <div className="h-6 bg-gray-200 rounded w-8 ml-auto"></div>
          </div>
          <div className="text-right">
            <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
            <div className="h-6 bg-gray-200 rounded w-20 ml-auto"></div>
          </div>
          <div className="text-right">
            <div className="h-4 bg-gray-200 rounded w-28 mb-1"></div>
            <div className="h-6 bg-gray-200 rounded w-8 ml-auto"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default {
  SkeletonPlayer,
  SkeletonPlayerList,
  SkeletonTeamInfo
}; 