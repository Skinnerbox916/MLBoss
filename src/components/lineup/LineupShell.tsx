'use client';

import { useState } from 'react';
import Tabs from '@/components/ui/Tabs';
import { Heading } from '@/components/typography';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import LineupManager from './LineupManager';
import TodayPitchers from './TodayPitchers';
import PointsPitchers from './PointsPitchers';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type Tab = 'batters' | 'pitchers';

/**
 * Tab shell for the Lineup page — one shell for BOTH league types. The
 * batters tab (`LineupManager`) is mode-aware internally (categories rating vs
 * points scoring, Game Plan only in categories). The pitchers tab swaps the
 * categories `TodayPitchers` for `PointsPitchers` in points mode.
 */
export default function LineupShell() {
  const { teamKey, leagueKey, scoringType, mode: leagueMode } = useActiveLeague();
  const [tab, setTab] = useState<Tab>('batters');

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Heading as="h1">Lineup</Heading>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set today&apos;s lineup and sit/start your pitchers
          </p>
        </div>
        <Tabs
          variant="segment"
          items={[
            { id: 'batters', label: 'Batters' },
            { id: 'pitchers', label: 'Pitchers' },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel="Batters or pitchers"
          className="sm:w-72"
        />
      </div>

      {tab === 'batters' ? (
        <LineupManager mode="batting" embedded />
      ) : leagueMode === 'points' ? (
        <PointsPitchers leagueKey={leagueKey} teamKey={teamKey} scoringType={scoringType} />
      ) : (
        <TodayPitchers teamKey={teamKey} date={todayStr()} />
      )}
    </div>
  );
}
