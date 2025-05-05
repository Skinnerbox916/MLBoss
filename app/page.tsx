'use client';

import { useState } from 'react';

const sampleLineup = [
  { id: 1, name: 'Sample C', position: 'C' },
  { id: 2, name: 'Sample 1B', position: '1B' },
  { id: 3, name: 'Sample 2B', position: '2B' },
  { id: 4, name: 'Sample SS', position: 'SS' },
  { id: 5, name: 'Sample 3B', position: '3B' },
  { id: 6, name: 'Sample OF1', position: 'OF' },
  { id: 7, name: 'Sample OF2', position: 'OF' },
  { id: 8, name: 'Sample OF3', position: 'OF' },
  { id: 9, name: 'Sample UTIL', position: 'UTIL' },
];

const positions = ['1B', '2B', '3B', 'SS', 'OF'] as const;
type Position = typeof positions[number];

type DummyPlayer = { name: string; stats: string };
const dummyPlayersByPosition: Record<Position, DummyPlayer[]> = {
  '1B': [
    { name: 'Sample 1B', stats: 'HR: 2, AVG: .300' },
    { name: 'Bench 1B', stats: 'HR: 1, AVG: .250' },
  ],
  '2B': [
    { name: 'Sample 2B', stats: 'HR: 1, AVG: .280' },
    { name: 'Bench 2B', stats: 'HR: 0, AVG: .240' },
  ],
  '3B': [
    { name: 'Sample 3B', stats: 'HR: 3, AVG: .270' },
    { name: 'Bench 3B', stats: 'HR: 1, AVG: .220' },
  ],
  'SS': [
    { name: 'Sample SS', stats: 'HR: 0, AVG: .310' },
    { name: 'Bench SS', stats: 'HR: 1, AVG: .200' },
  ],
  'OF': [
    { name: 'Sample OF1', stats: 'HR: 2, AVG: .260' },
    { name: 'Sample OF2', stats: 'HR: 1, AVG: .250' },
    { name: 'Sample OF3', stats: 'HR: 0, AVG: .240' },
  ],
};

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position>('1B');

  const handleLogin = () => {
    setIsLoggedIn(true);
  };

  if (!isLoggedIn) {
    return (
      <div className="max-w-4xl mx-auto min-h-[60vh] flex flex-col items-center justify-center">
        <h1 className="text-3xl font-bold mb-8 text-center">MLB Lineup Manager</h1>
        <div className="flex flex-col items-center justify-center p-8 border rounded-lg">
          <h2 className="text-xl mb-4">Please log in to view your lineup</h2>
          <button
            onClick={handleLogin}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="DashboardLayout min-h-screen flex flex-col pb-24">
      <div className="flex flex-col md:flex-row max-w-6xl mx-auto w-full min-h-[60vh] gap-4 p-4">
        {/* Left Sidebar: LineupPanel */}
        <aside className="LineupPanel bg-gray-50 rounded-lg p-4 border w-full md:w-[30%]">
          <h2 className="text-lg font-semibold mb-4">Your Lineup</h2>
          <ul className="space-y-2">
            {sampleLineup.map((player) => (
              <li key={player.id} className="flex items-center gap-3 p-2 bg-white rounded shadow-sm">
                <span className="font-bold w-10 text-purple-800">{player.position}</span>
                <span className="text-gray-700">{player.name}</span>
              </li>
            ))}
          </ul>
        </aside>
        {/* Right Main: EvaluationPanel */}
        <main className="EvaluationPanel bg-gray-50 rounded-lg p-4 border w-full md:w-[70%]">
          <div className="mb-4 flex flex-wrap gap-2 items-center">
            <span className="font-semibold mr-2">Select Position:</span>
            {positions.map((pos) => (
              <button
                key={pos}
                className={`px-3 py-1 rounded border text-sm font-medium ${selectedPosition === pos ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'}`}
                onClick={() => setSelectedPosition(pos)}
              >
                {pos}
              </button>
            ))}
          </div>
          <h2 className="text-lg font-semibold mb-4">Slot: {selectedPosition}</h2>
          <div className="mb-4">
            <div className="font-medium text-gray-700 mb-2">AI Suggestion</div>
            <div className="bg-white p-3 rounded shadow-sm text-gray-600">
              Try starting {dummyPlayersByPosition[selectedPosition][0].name} for best matchup potential.
            </div>
          </div>
          <div className="mb-4">
            <div className="font-medium text-gray-700 mb-2">Compared Players</div>
            <ul className="space-y-2">
              {dummyPlayersByPosition[selectedPosition].map((player: DummyPlayer, idx: number) => (
                <li key={idx} className="flex items-center gap-3 p-2 bg-white rounded shadow-sm">
                  <span className="font-bold text-purple-800">{player.name}</span>
                  <span className="text-gray-700 text-xs">{player.stats}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-between mt-6">
            <button
              className="text-blue-600 hover:underline"
              onClick={() => {
                const idx = positions.indexOf(selectedPosition);
                setSelectedPosition(positions[(idx - 1 + positions.length) % positions.length]);
              }}
            >
              &larr; Prev Slot
            </button>
            <button
              className="text-blue-600 hover:underline"
              onClick={() => {
                const idx = positions.indexOf(selectedPosition);
                setSelectedPosition(positions[(idx + 1) % positions.length]);
              }}
            >
              Next Slot &rarr;
            </button>
          </div>
        </main>
      </div>
      {/* Fixed Bottom Bar: MatchupStats */}
      <div className="MatchupStats fixed bottom-0 left-0 w-full bg-white border-t shadow-lg h-24 flex flex-wrap justify-center items-center gap-6 z-50">
        <div className="flex flex-col items-center">
          <span className="text-xs text-gray-500">HR</span>
          <span className="font-bold text-lg">6 <span className="text-gray-400">vs</span> 5</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-gray-500">AVG</span>
          <span className="font-bold text-lg">.271 <span className="text-gray-400">vs</span> .265</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-gray-500">SB</span>
          <span className="font-bold text-lg">4 <span className="text-gray-400">vs</span> 3</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-gray-500">R</span>
          <span className="font-bold text-lg">22 <span className="text-gray-400">vs</span> 19</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-gray-500">RBI</span>
          <span className="font-bold text-lg">18 <span className="text-gray-400">vs</span> 15</span>
        </div>
      </div>
    </div>
  );
} 