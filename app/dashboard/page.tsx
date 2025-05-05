"use client";
import { useState, useEffect } from 'react';

const YAHOO_CLIENT_ID = 'dj0yJmk9eUFSWTNWZW9GWFFVJmQ9WVdrOWRYVkVaazF3TWswbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTk5';
const YAHOO_REDIRECT_URI = 'https://e657-45-29-68-219.ngrok-free.app/api/auth/callback';
const YAHOO_AUTH_URL = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${YAHOO_CLIENT_ID}&redirect_uri=${encodeURIComponent(YAHOO_REDIRECT_URI)}&response_type=code&language=en-us&scope=openid%20fspt-w`;

const positions = ['1B', '2B', '3B', 'SS', 'OF'] as const;
type Position = typeof positions[number];

type Player = { name: string; position: string };

function getCookie(name: string) {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

function deleteCookie(name: string) {
  if (typeof document !== 'undefined') {
    document.cookie = `${name}=; Max-Age=0; path=/;`;
  }
}

export default function Dashboard() {
  const [selectedPosition, setSelectedPosition] = useState<Position>('1B');
  const [roster, setRoster] = useState<Player[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check for access token on mount
  useEffect(() => {
    const token = getCookie('yahoo_access_token');
    if (!token) {
      window.location.href = '/?error=token_expired';
    }
  }, []);

  useEffect(() => {
    async function fetchRoster() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/yahoo/roster');
        if (res.status === 401) {
          deleteCookie('yahoo_access_token');
          window.location.href = '/?error=token_expired';
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch roster');
        const data = await res.json();
        // Parse the Yahoo API response to extract player names and positions
        // This is a placeholder; you may need to adjust based on actual API response
        const players: Player[] = [];
        setRoster(players.length ? players : [
          { name: 'Sample Player 1', position: '1B' },
          { name: 'Sample Player 2', position: '2B' },
        ]);
      } catch (err: any) {
        setError(err.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchRoster();
  }, []);

  return (
    <div className="DashboardLayout min-h-screen flex flex-col pb-24">
      <div className="flex flex-col md:flex-row max-w-6xl mx-auto w-full min-h-[60vh] gap-4 p-4">
        {/* Left Sidebar: LineupPanel */}
        <aside className="LineupPanel bg-gray-50 rounded-lg p-4 border w-full md:w-[30%]">
          <h2 className="text-lg font-semibold mb-4">Your Lineup</h2>
          {loading && <div>Loading roster...</div>}
          {error && <div className="text-red-600">{error}</div>}
          {!loading && !error && (
            <ul className="space-y-2">
              {roster && roster.map((player, idx) => (
                <li key={idx} className="flex items-center gap-3 p-2 bg-white rounded shadow-sm">
                  <span className="font-bold w-10 text-purple-800">{player.position}</span>
                  <span className="text-gray-700">{player.name}</span>
                </li>
              ))}
            </ul>
          )}
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
              Try starting a player for best matchup potential.
            </div>
          </div>
          <div className="mb-4">
            <div className="font-medium text-gray-700 mb-2">Compared Players</div>
            <ul className="space-y-2">
              <li className="flex items-center gap-3 p-2 bg-white rounded shadow-sm">
                <span className="font-bold text-purple-800">Sample Player 1</span>
                <span className="text-gray-700 text-xs">HR: 2, AVG: .300</span>
              </li>
              <li className="flex items-center gap-3 p-2 bg-white rounded shadow-sm">
                <span className="font-bold text-purple-800">Sample Player 2</span>
                <span className="text-gray-700 text-xs">HR: 1, AVG: .250</span>
              </li>
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