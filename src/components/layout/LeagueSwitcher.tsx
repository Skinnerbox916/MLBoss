'use client';

import Badge from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { useActiveLeague } from '@/lib/hooks/useActiveLeague';
import { setActiveLeagueKey } from '@/lib/hooks/activeLeagueStore';
import { scoringModeForType } from '@/lib/fantasy/scoringMode';

/**
 * Multi-league switcher — the seed of the full team switcher. Lives in the
 * account drawer (global chrome, both desktop + mobile) and renders only when
 * the user has more than one league. Persists the choice via
 * `setActiveLeagueKey` (localStorage) so it survives navigation; every
 * mode-routed page follows through `useActiveLeague`. Each row is tagged
 * Pts/Cats so the user knows which experience they'll get.
 */
export default function LeagueSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { leagues, leagueKey } = useActiveLeague();
  if (leagues.length <= 1) return null;

  return (
    <div className="mb-3">
      <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        League
      </p>
      <div className="space-y-1">
        {leagues.map((l) => {
          const active = l.league_key === leagueKey;
          const isPoints = scoringModeForType(l.scoring_type) === 'points';
          return (
            <button
              key={l.league_key}
              onClick={() => { setActiveLeagueKey(l.league_key); onNavigate?.(); }}
              className={cn(
                'group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors',
                active
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="flex-1 truncate">{l.league_name}</span>
              <Badge color={isPoints ? 'accent' : 'muted'}>{isPoints ? 'Pts' : 'Cats'}</Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}
