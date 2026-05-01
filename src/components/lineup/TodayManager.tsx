'use client';

import { useState } from 'react';
import Tabs from '@/components/ui/Tabs';
import MatchupPulse from '@/components/shared/MatchupPulse';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import LineupManager from './LineupManager';
import TodayPitchers from './TodayPitchers';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type Tab = 'batters' | 'pitchers';

/**
 * Wrapper for the Today page. Owns the tab state and the always-on matchup
 * pulse so both batter lineup and pitcher sit/start decisions have the same
 * category scoreboard visible at the top of the page.
 */
export default function TodayManager() {
  const { teamKey, leagueKey } = useFantasyContext();
  const [tab, setTab] = useState<Tab>('batters');

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Today</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set your lineup and sit/start your pitchers for today&apos;s games
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

      <MatchupPulse leagueKey={leagueKey} teamKey={teamKey} side="both" />

      {tab === 'batters' ? (
        <LineupManager mode="batting" embedded />
      ) : (
        <TodayPitchers teamKey={teamKey} date={todayStr()} />
      )}
    </div>
  );
}
