'use client';

import type { LineupMode } from './types';

const BATTING_POSITIONS = [
  { key: 'C', label: 'C' },
  { key: '1B', label: '1B' },
  { key: '2B', label: '2B' },
  { key: '3B', label: '3B' },
  { key: 'SS', label: 'SS' },
  { key: 'OF', label: 'OF' },
  { key: 'UTIL', label: 'Util' },
  { key: 'BN', label: 'BN' },
  { key: 'IL', label: 'IL' },
];

const PITCHING_POSITIONS = [
  { key: 'SP', label: 'SP' },
  { key: 'RP', label: 'RP' },
  { key: 'P', label: 'P' },
  { key: 'BN', label: 'BN' },
  { key: 'IL', label: 'IL' },
];

interface PositionFilterProps {
  mode: LineupMode;
  selected: string | null;
  onSelect: (position: string | null) => void;
}

export default function PositionFilter({ mode, selected, onSelect }: PositionFilterProps) {
  const positions = mode === 'pitching' ? PITCHING_POSITIONS : BATTING_POSITIONS;
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          selected === null
            ? 'bg-primary text-white'
            : 'bg-surface text-muted-foreground hover:bg-surface-muted'
        }`}
      >
        All
      </button>
      {positions.map(pos => (
        <button
          key={pos.key}
          onClick={() => onSelect(selected === pos.key ? null : pos.key)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            selected === pos.key
              ? 'bg-primary text-white'
              : 'bg-surface text-muted-foreground hover:bg-surface-muted'
          }`}
        >
          {pos.label}
        </button>
      ))}
    </div>
  );
}
