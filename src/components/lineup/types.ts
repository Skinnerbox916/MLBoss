import type { RosterEntry } from '@/lib/yahoo-fantasy-api';

export type LineupMode = 'batting' | 'pitching';

export type RowStatus = 'starter' | 'bench' | 'injured';

export function getRowStatus(player: RosterEntry): RowStatus {
  if (player.on_disabled_list || player.status === 'IL' || player.status === 'IL10' || player.status === 'IL60' || player.status === 'DL' || player.status === 'NA') {
    return 'injured';
  }
  if (player.selected_position === 'BN') return 'bench';
  if (player.selected_position === 'IL' || player.selected_position === 'IL+' || player.selected_position === 'NA') return 'injured';
  return 'starter';
}

export function isPitcher(p: RosterEntry): boolean {
  return (
    p.eligible_positions.includes('P') ||
    p.eligible_positions.includes('SP') ||
    p.eligible_positions.includes('RP') ||
    p.display_position === 'SP' ||
    p.display_position === 'RP' ||
    p.display_position === 'P'
  );
}
